import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  killPty,
  resizePty,
  subscribePty,
  writePty,
} from "../../../platform/tauri/pty";
import {
  spawnNativeSession,
  type NativeProviderId,
} from "../../../platform/tauri/nativeSession";
import { IS_MAC } from "../../../platform/tauri/platform";
import { isLightScheme, SCHEME_CHANGE_EVENT } from "../../settings/model/appearance";
import { isOscColorQuery, oscColorReply } from "../../terminal/model/terminalChrome";
import {
  isMacTerminalClearShortcut,
  macTerminalShortcutData,
} from "../../terminal/model/terminalKeys";
import { fitTerminal } from "../../terminal/model/terminalLayout";
import { monoFont, oscColors, terminalTheme } from "../../terminal/ui/TerminalView";
import { setNativeSessionStatus } from "../model/nativeSessionStatus";
import { isNativeProvider } from "../model/nativeSession";
import type { Session } from "../model/session";
import {
  selectedProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";

/**
 * Native CLI sessions: each MonoCode session tab runs the provider's own TUI
 * (`claude`, `codex`, ...) in a PTY. The xterm instance lives here, outside
 * React, so switching tabs or projects never kills or redraws the agent — a
 * pane only borrows the terminal's DOM node while it is on screen. The
 * process stops when the session leaves the app (see disposeNativeTerminal).
 */

export type NativeLaunch = {
  cwd: string;
  provider: NativeProviderId;
  accountId?: string;
  conversationId: string;
};

export type NativeTerminalState = { exited: boolean; error?: string };

type Entry = {
  id: string;
  term: Terminal;
  outer: HTMLDivElement;
  host: HTMLDivElement;
  state: NativeTerminalState;
  /** The CLI process was spawned and accepts input. */
  started: boolean;
  /** Prompts sent while the CLI was still starting; typed once it is up. */
  pendingPrompts: string[];
  listeners: Set<(state: NativeTerminalState) => void>;
  onTitle?: (title: string) => void;
  fit: () => void;
  dispose: () => void;
};

const entries = new Map<string, Entry>();
/** Sessions whose next spawn starts a new conversation rather than resuming. */
const freshLaunches = new Set<string>();

/** Prompts to hand the CLI when its session next starts. */
const initialPrompts = new Map<string, string>();

/** Queue a prompt for the session's next CLI start. */
export function setNativeInitialPrompt(id: string, prompt: string): void {
  const queued = initialPrompts.get(id);
  initialPrompts.set(id, queued ? `${queued}\n\n${prompt}` : prompt);
}

/** Strip escape sequences so pasted text cannot end the paste early. */
function pasteSafe(prompt: string): string {
  return prompt.replace(/\x1b/g, "");
}

function typePrompt(id: string, prompt: string) {
  void writePty(id, `\x1b[200~${pasteSafe(prompt)}\x1b[201~`)
    .then(() => new Promise((resolve) => setTimeout(resolve, 60)))
    .then(() => writePty(id, "\r"))
    .catch(() => undefined);
}

/** Time a freshly spawned TUI gets to draw before a prompt is typed in. */
const TUI_READY_MS = 1500;

/**
 * Hand a prompt to the session's CLI if one is running or starting:
 * `"sent"` types it in now, `"queued"` types it once the CLI is up, and
 * `"none"` means no live CLI (an exited one is cleared) so the caller must
 * start one with the prompt.
 */
export function deliverNativePrompt(
  id: string,
  prompt: string,
): "sent" | "queued" | "none" {
  const entry = entries.get(id);
  if (!entry) return "none";
  if (entry.state.exited) {
    entries.delete(id);
    entry.dispose();
    return "none";
  }
  if (!entry.started) {
    entry.pendingPrompts.push(prompt);
    return "queued";
  }
  typePrompt(id, prompt);
  return "sent";
}

/**
 * Session fields that launch `session` as a new native CLI conversation:
 * its provider (Claude Code unless it already names a native CLI), the
 * project's selected profile, and a fresh conversation id. `prompt`, when
 * given, becomes the CLI's first prompt.
 */
export function nativeLaunchPatch(
  session: Pick<Session, "id" | "harness" | "cwd" | "providerAccountId">,
  prompt?: string,
): Required<Pick<Session, "harness" | "providerSessionId">> &
  Pick<Session, "providerAccountId"> {
  const harness = isNativeProvider(session.harness) ? session.harness : "claude";
  if (prompt) setNativeInitialPrompt(session.id, prompt);
  markFreshNativeLaunch(session.id);
  return {
    harness,
    providerAccountId: supportsProviderAccounts(harness)
      ? (session.providerAccountId ??
        selectedProviderAccountId(harness, session.cwd))
      : undefined,
    providerSessionId: crypto.randomUUID(),
  };
}

/** Mark that the next spawn for `id` is a brand-new conversation. */
export function markFreshNativeLaunch(id: string): void {
  freshLaunches.add(id);
}

function setState(entry: Entry, state: NativeTerminalState) {
  entry.state = state;
  for (const listener of entry.listeners) listener(state);
}

function createEntry(id: string, launch: NativeLaunch): Entry {
  const outer = document.createElement("div");
  outer.className =
    "monocode-terminal monocode-native-session flex h-full w-full min-h-0 min-w-0 flex-col";
  const host = document.createElement("div");
  host.className = "monocode-terminal-host min-h-0 min-w-0 flex-1 overflow-hidden";
  outer.appendChild(host);

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: monoFont(),
    fontSize: 13,
    lineHeight: 1,
    letterSpacing: 0,
    scrollback: 10000,
    allowTransparency: true,
    smoothScrollDuration: 0,
    theme: terminalTheme(isLightScheme()),
    macOptionIsMeta: IS_MAC,
  });

  let closed = false;
  let spawned = false;
  let resolveStart!: () => void;
  let rejectStart!: (error: unknown) => void;
  const starting = new Promise<void>((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });
  void starting.catch(() => undefined);
  const whenStarted = (fn: () => unknown) => {
    void starting
      .then(() => (closed ? undefined : fn()))
      .catch(() => undefined);
  };

  const entry: Entry = {
    id,
    term,
    outer,
    host,
    state: { exited: false },
    started: false,
    pendingPrompts: [],
    listeners: new Set(),
    fit: () => {},
    dispose: () => {},
  };

  const onCopy = (event: ClipboardEvent) => {
    const text = term.getSelection();
    if (!text) return;
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
  };
  const onPaste = (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    term.paste(text);
  };
  host.addEventListener("copy", onCopy);
  host.addEventListener("paste", onPaste);

  term.attachCustomKeyEventHandler((event) => {
    // Shift+Enter inserts a newline in Claude Code / Codex, the same mapping
    // their `/terminal-setup` installs in other terminals.
    if (
      event.key === "Enter" &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      if (event.type === "keydown") {
        event.preventDefault();
        whenStarted(() => writePty(id, "\x1b\r"));
      }
      return false;
    }
    const shortcutData = IS_MAC ? macTerminalShortcutData(event) : null;
    if (shortcutData) {
      if (event.type === "keydown") {
        event.preventDefault();
        event.stopPropagation();
        term.input(shortcutData);
      }
      return false;
    }
    if (IS_MAC && isMacTerminalClearShortcut(event)) {
      if (event.isComposing) return false;
      if (event.type === "keydown") {
        event.preventDefault();
        term.clear();
      }
      return false;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.altKey) return true;
    const key = event.key.toLowerCase();
    if (key === "c") {
      if (term.hasSelection()) return false;
      if (event.metaKey && !event.ctrlKey) return false;
      return true;
    }
    if (key === "v") {
      // On macOS Ctrl+V reaches the CLI, which reads images from the clipboard
      // itself; Cmd+V is a normal text paste.
      if (IS_MAC && event.ctrlKey && !event.metaKey) return true;
      return false;
    }
    return true;
  });

  const unsubscribe = subscribePty(
    id,
    (data) => term.write(data),
    (code) => {
      if (closed) return;
      const status = code == null ? "" : ` (${code})`;
      term.writeln(`\r\n\x1b[2m[session ended${status}]\x1b[0m`);
      setNativeSessionStatus(id, null);
      setState(entry, { exited: true });
    },
  );

  const dataSub = term.onData((data) => whenStarted(() => writePty(id, data)));
  const titleSub = term.onTitleChange((title) => entry.onTitle?.(title));

  const replyOsc = (code: 10 | 11 | 12, hex: string) => {
    const reply = oscColorReply(code, hex);
    if (reply) whenStarted(() => writePty(id, reply));
    return true;
  };
  const oscFg = term.parser.registerOscHandler(10, (data) =>
    isOscColorQuery(data) ? replyOsc(10, oscColors().fg) : false,
  );
  const oscBg = term.parser.registerOscHandler(11, (data) =>
    isOscColorQuery(data) ? replyOsc(11, oscColors().bg) : false,
  );
  const oscCursor = term.parser.registerOscHandler(12, (data) =>
    isOscColorQuery(data) ? replyOsc(12, oscColors().cursor) : false,
  );

  const onSchemeChange = () => {
    term.options.theme = terminalTheme(isLightScheme());
  };
  window.addEventListener(SCHEME_CHANGE_EVENT, onSchemeChange);

  term.attachCustomWheelEventHandler(() => {
    if (term.element?.classList.contains("enable-mouse-events")) return true;
    return term.buffer.active.type !== "alternate";
  });

  let lastCols = 0;
  let lastRows = 0;
  const spawn = (cols: number, rows: number) => {
    const fresh = freshLaunches.delete(id);
    const initialPrompt = initialPrompts.get(id);
    initialPrompts.delete(id);
    spawnNativeSession({
      id,
      cwd: launch.cwd,
      cols,
      rows,
      provider: launch.provider,
      accountId: launch.accountId,
      conversationId: launch.conversationId,
      resume: !fresh,
      initialPrompt,
    })
      .then((result) => {
        if (closed) {
          // Disposed while spawning: nothing will wait on `starting`, so stop
          // the CLI that just came up instead of leaving it headless.
          void killPty(id);
          return;
        }
        spawned = true;
        entry.started = true;
        resolveStart();
        const typed = [
          ...(initialPrompt && !result.promptDelivered ? [initialPrompt] : []),
          ...entry.pendingPrompts.splice(0),
        ];
        if (typed.length) {
          // Give the TUI a moment to draw, then type what is waiting.
          setTimeout(() => {
            if (!closed) for (const prompt of typed) typePrompt(id, prompt);
          }, TUI_READY_MS);
        }
      })
      .catch((error: unknown) => {
        if (fresh) freshLaunches.add(id);
        for (const prompt of [
          ...(initialPrompt ? [initialPrompt] : []),
          ...entry.pendingPrompts.splice(0),
        ])
          setNativeInitialPrompt(id, prompt);
        const message = error instanceof Error ? error.message : String(error);
        if (!closed) {
          term.writeln(`\x1b[31m${message}\x1b[0m`);
          setState(entry, { exited: true, error: message });
        }
        rejectStart(error);
      });
  };

  entry.fit = () => {
    if (closed || !host.isConnected) return;
    const mode = term.buffer.active.type === "alternate" ? "tui" : "shell";
    const next = fitTerminal(term, host, mode);
    if (!next) return;
    const { cols, rows } = next;
    if (!spawned && lastCols === 0) {
      lastCols = cols;
      lastRows = rows;
      spawn(cols, rows);
      return;
    }
    if (cols === lastCols && rows === lastRows) return;
    lastCols = cols;
    lastRows = rows;
    whenStarted(() =>
      resizePty(id, cols, rows).catch(() => {
        lastCols = 0;
        lastRows = 0;
      }),
    );
  };

  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      entry.fit();
    });
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(host);
  const bufferSub = term.buffer.onBufferChange(schedule);

  entry.dispose = () => {
    if (closed) return;
    closed = true;
    if (raf) cancelAnimationFrame(raf);
    observer.disconnect();
    host.removeEventListener("copy", onCopy);
    host.removeEventListener("paste", onPaste);
    window.removeEventListener(SCHEME_CHANGE_EVENT, onSchemeChange);
    dataSub.dispose();
    titleSub.dispose();
    oscFg.dispose();
    oscBg.dispose();
    oscCursor.dispose();
    bufferSub.dispose();
    unsubscribe();
    void starting.catch(() => undefined).then(() => killPty(id));
    setNativeSessionStatus(id, null);
    term.dispose();
    outer.remove();
  };

  return entry;
}

let parking: HTMLDivElement | null = null;

/** Off-screen home for terminals started before their pane is shown. */
function parkingLot(): HTMLDivElement {
  if (parking?.isConnected) return parking;
  parking = document.createElement("div");
  parking.setAttribute("aria-hidden", "true");
  Object.assign(parking.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: "1200px",
    height: "800px",
    visibility: "hidden",
    pointerEvents: "none",
  });
  document.body.appendChild(parking);
  return parking;
}

/**
 * Start the session's CLI now, even though no pane shows it yet (an
 * automation or a prompt sent to a background tab). A pane that opens later
 * takes over the same terminal.
 */
export function startNativeTerminal(id: string, launch: NativeLaunch): void {
  if (entries.has(id)) return;
  const entry = createEntry(id, launch);
  entries.set(id, entry);
  parkingLot().appendChild(entry.outer);
  entry.term.open(entry.host);
  requestAnimationFrame(() => entry.fit());
}

/**
 * Show the session's terminal inside `container`, starting the CLI on first
 * use. Returns a detach function that keeps the process running.
 */
export function attachNativeTerminal(
  id: string,
  container: HTMLElement,
  launch: NativeLaunch,
  callbacks: {
    onState: (state: NativeTerminalState) => void;
    onTitle?: (title: string) => void;
  },
): () => void {
  let entry = entries.get(id);
  const created = !entry;
  if (!entry) {
    entry = createEntry(id, launch);
    entries.set(id, entry);
  }
  const current = entry;
  container.appendChild(current.outer);
  if (created) current.term.open(current.host);
  current.onTitle = callbacks.onTitle;
  current.listeners.add(callbacks.onState);
  callbacks.onState(current.state);
  const frame = requestAnimationFrame(() => {
    current.fit();
    current.term.refresh(0, current.term.rows - 1);
  });
  return () => {
    cancelAnimationFrame(frame);
    current.listeners.delete(callbacks.onState);
    if (current.onTitle === callbacks.onTitle) current.onTitle = undefined;
    if (current.outer.parentElement === container) current.outer.remove();
  };
}

export function focusNativeTerminal(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;
  entry.fit();
  entry.term.focus();
}

export function hasNativeTerminal(id: string): boolean {
  return entries.has(id);
}

/** Stop the CLI and forget its terminal; the next attach starts it again. */
export function disposeNativeTerminal(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;
  entries.delete(id);
  entry.dispose();
}

export function nativeTerminalIds(): string[] {
  return [...entries.keys()];
}
