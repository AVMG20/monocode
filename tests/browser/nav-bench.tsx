import { Profiler } from "react";
import { createRoot } from "react-dom/client";
import { newSession } from "../../src/features/sessions/model/session";
import { newTab } from "../../src/features/workspace/model/layout";
import "../../src/styles/index.css";

// Portable navigation benchmark: the real App with Tauri IPC faked. The same
// file runs unchanged at v0.10, v0.13, v0.15 and HEAD.
type Block = { id: string; role: string; text: string; [key: string]: unknown };
const ALPHA = "/fixture/alpha";
const BETA = "/fixture/beta";
const commands = new Map<string, number>();
const unknown = new Map<string, number>();

// --- Tauri event plugin emulation ------------------------------------------------
const callbacks = new Map<number, (payload: unknown) => void>();
let nextCallback = 1;
const listeners = new Map<string, Set<number>>();
const transformCallback = (callback?: (payload: unknown) => void) => {
  const id = nextCallback++;
  if (callback) callbacks.set(id, callback);
  return id;
};
let eventId = 1;
const emit = (event: string, payload: unknown) => {
  for (const handler of listeners.get(event) ?? [])
    callbacks.get(handler)?.({ event, id: eventId++, payload });
};

const rich = new URLSearchParams(location.search).has("rich");
// ?rich: turns look like real agent work: reasoning, file reads, edits with
// diff previews, shell output, then the reply.
const richTurn = (prefix: string, turn: number): Block[] =>
  [
    {
      id: `${prefix}-u${turn}`,
      role: "user",
      text: `Inspect module ${turn} and fix what you find.`,
      startedAt: Date.now() - 3_600_000 + turn * 1000,
      durationMs: 42_000,
    },
    { id: `${prefix}-r${turn}`, role: "reasoning", text: "Let me look at the module first. ".repeat(6) },
    {
      id: `${prefix}-t${turn}a`,
      role: "tool",
      text: "",
      tool: {
        callId: `${prefix}-c${turn}a`,
        title: "Read src/sample.ts",
        kind: "read",
        status: "completed",
        preview: {
          kind: "read",
          path: "/fixture/alpha/src/sample.ts",
          fileName: "sample.ts",
          startLine: 1,
          lines: Array.from({ length: 12 }, (_, i) => ({
            number: i + 1,
            kind: "context",
            text: `export const value${i} = processItem(${i});`,
          })),
        },
      },
    },
    {
      id: `${prefix}-t${turn}b`,
      role: "tool",
      text: "",
      tool: {
        callId: `${prefix}-c${turn}b`,
        title: "Edit src/sample.ts",
        kind: "edit",
        status: "completed",
        preview: {
          kind: "write",
          path: "/fixture/alpha/src/sample.ts",
          fileName: "sample.ts",
          startLine: 4,
          additions: 3,
          deletions: 2,
          lines: [
            { number: 4, kind: "context", text: "export function run() {" },
            { number: 5, kind: "del", text: "  return processItem(1);" },
            { number: 5, kind: "del", text: "  // old" },
            { number: 5, kind: "add", text: "  const result = processItem(2);" },
            { number: 6, kind: "add", text: "  log(result);" },
            { number: 7, kind: "add", text: "  return result;" },
            { number: 8, kind: "context", text: "}" },
          ],
        },
      },
    },
    {
      id: `${prefix}-t${turn}c`,
      role: "tool",
      text: "",
      tool: {
        callId: `${prefix}-c${turn}c`,
        title: "npm test",
        kind: "execute",
        status: "completed",
        preview: { kind: "shell", output: "PASS src/sample.test.ts\n  ✓ runs (3 ms)\n\nTests: 1 passed" },
      },
    },
    {
      id: `${prefix}-a${turn}`,
      role: "assistant",
      text: `## Module ${turn}\n\nUpdated [sample.ts](sample.ts) so \`run\` logs its result.\n\n- Kept the public API\n- Added a log line\n\n\`\`\`typescript\nconst result = processItem(${turn});\n\`\`\``,
    },
  ] as Block[];
const transcript = (prefix: string, marker: string, turns: number): Block[] => [
  ...Array.from({ length: turns }, (_, turn) => rich ? richTurn(prefix, turn) : [
    { id: `${prefix}-u${turn}`, role: "user" as const, text: `Inspect module ${turn}.` },
    {
      id: `${prefix}-a${turn}`,
      role: "assistant" as const,
      text: `## Module ${turn}\n\nReview [sample.ts](sample.ts).\n\n${"This module processes the local sample data and records its result. ".repeat(12)}\n\n\`\`\`typescript\n${Array.from({ length: 25 }, (_, line) => `const value${line} = processItem(${line});`).join("\n")}\n\`\`\``,
    },
  ]).flat(),
  { id: `${prefix}-ufinal`, role: "user", text: "Wrap up." },
  { id: `${prefix}-afinal`, role: "assistant", text: `### ${marker}\n\nDone.` },
];

const base = Date.now() - 3_600_000;
type Fixture = ReturnType<typeof newSession> & { blocks: Block[] };
const make = (
  id: string,
  title: string,
  cwd: string,
  index: number,
): Fixture => ({
  ...newSession("claude", cwd),
  id,
  title,
  blocks: transcript(id, `MARK-${id}`, 100),
  worktreeCwd: `${cwd}-wt/${index}`,
}) as Fixture;
const openAlpha = Array.from({ length: 6 }, (_, i) =>
  make(`workspace-session-${i}`, `Session ${i + 1}`, ALPHA, i),
);
const openBeta = Array.from({ length: 2 }, (_, i) =>
  make(`beta-session-${i}`, `Beta ${i + 1}`, BETA, 10 + i),
);
const history = Array.from({ length: 12 }, (_, i) =>
  make(`history-session-${i}`, `Archive ${i + 1}`, ALPHA, 20 + i),
);
// ?filler=N adds N older, short sessions to every project; ?projects=N adds
// more projects to the sidebar. Real sidebars hold hundreds of sessions.
const query = new URLSearchParams(location.search);
const fillerCount = Number(query.get("filler") ?? 0);
const extraProjects = Array.from(
  { length: Number(query.get("projects") ?? 0) },
  (_, i) => `/fixture/project-${i}`,
);
const filler: Fixture[] = [];
for (const cwd of [ALPHA, BETA, ...extraProjects])
  for (let i = 0; i < fillerCount; i++)
    filler.push({
      ...newSession("claude", cwd),
      id: `filler-${cwd.split("/").pop()}-${i}`,
      title: `Old task ${i} in ${cwd.split("/").pop()}`,
      blocks: transcript(`filler-${cwd}-${i}`, `MARK-filler-${cwd.split("/").pop()}-${i}`, 3),
    } as Fixture);
const all = [...openAlpha, ...openBeta, ...history, ...filler];
const byId = new Map(all.map((session) => [session.id, session]));
const updatedAt = new Map(
  all.map((session, i) => [
    session.id,
    session.id.startsWith("filler-") ? base - (i + 1) * 60_000 : base + i * 1000,
  ]),
);
const summary = (session: Fixture) => ({
  id: session.id,
  cwd: session.cwd,
  harness: session.harness,
  model: session.model,
  runtimeMode: session.runtimeMode,
  title: session.title,
  worktreeCwd: session.worktreeCwd,
  additions: 0,
  deletions: 0,
  createdAt: updatedAt.get(session.id)!,
  updatedAt: updatedAt.get(session.id)!,
});
const record = (session: Fixture) => ({
  id: session.id,
  cwd: session.cwd,
  harness: session.harness,
  model: session.model,
  modelSettings: {},
  runtimeMode: session.runtimeMode,
  title: session.title,
  blocks: session.blocks,
  worktreeCwd: session.worktreeCwd,
  createdAt: updatedAt.get(session.id)!,
  updatedAt: updatedAt.get(session.id)!,
});
const sessionGetDelay = Number(new URLSearchParams(location.search).get("ipcDelay") ?? 5);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const source = Array.from({ length: 80 }, (_, i) => `export const value${i} = ${i};`).join("\n");
const filesFor = (cwd: string) => [
  {
    path: `${cwd}/sample.ts`,
    relative: "sample.ts",
    name: "sample.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    staged: false,
    unstaged: true,
  },
];

const invoke = async (command: string, args: Record<string, unknown> = {}) => {
  commands.set(command, (commands.get(command) ?? 0) + 1);
  if (command === "plugin:event|listen") {
    const event = String(args.event);
    const set = listeners.get(event) ?? new Set();
    set.add(Number(args.handler));
    listeners.set(event, set);
    return Number(args.handler);
  }
  if (command === "plugin:event|unlisten") {
    listeners.get(String(args.event))?.delete(Number(args.eventId));
    return;
  }
  if (command === "plugin:event|emit" || command === "plugin:event|emit_to") return;
  if (command.startsWith("plugin:window|") || command.startsWith("plugin:webview|")) return null;
  if (command.startsWith("plugin:app|")) return command.endsWith("version") ? "0.0.0" : null;
  if (command.startsWith("plugin:path|")) return "/fixture/home";
  if (command === "session_list_by_project") {
    const cwd = String(args.cwd);
    return all
      .filter((session) => session.cwd === cwd)
      .map(summary)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  if (command === "session_get") {
    const session = byId.get(String(args.sessionId));
    await delay(sessionGetDelay);
    return session ? record(session) : null;
  }
  if (command === "session_list_linked" || command === "session_list_in_flight") return [];
  if (command === "session_upsert" || command === "session_save" || command.startsWith("session_set"))
    return;
  if (command === "control_load") return null;
  if (command === "reminder_list") return [];
  if (command === "reminder_take_open") return null;
  if (command === "reminder_configure" || command === "reminder_register_window") return;
  if (command === "session_checkpoint_status") return { files: [] };
  if (command === "set_window_background_blur") return;
  const cwd = String(args.cwd ?? ALPHA);
  if (command === "list_project_files") return filesFor(cwd);
  if (command === "read_text_file") return source;
  if (command === "git_diff_stats") return { files: 1, additions: 1, deletions: 1 };
  if (command === "git_diff_index" || command === "git_diff_files")
    return {
      branch: `worktree-${cwd.split("/").pop()}`,
      head: "fixture",
      files: filesFor(cwd),
      additions: 1,
      deletions: 1,
      ahead: 0,
      behind: 0,
      aheadOfDefault: 0,
      headPushed: true,
      remote: null,
      upstream: null,
      defaultBranch: "main",
    };
  if (command === "git_file_diff")
    return {
      ...filesFor(cwd)[0],
      original: source,
      current: source.replace("value0 = 0", "value0 = 1"),
      binary: false,
      tooLarge: false,
    };
  if (command === "resource_usage") return { cpuPercent: 20, memoryPressure: 1 };
  if (command === "list_skills") return [];
  if (command === "git_branch") return "main";
  if (command === "autosave_set_enabled" || command === "keybindings_set_overrides") return;
  if (command === "quick_composer_take") return null;
  if (command === "home_dir") return "/fixture/home";
  unknown.set(command, (unknown.get(command) ?? 0) + 1);
  throw new Error(`Unavailable fixture service: ${command}`);
};

Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback,
    unregisterCallback: (id: number) => callbacks.delete(id),
    invoke,
    convertFileSrc: (path: string) => path,
  },
});

// ?css=...: diagnostic stylesheet override, to attribute engine cost to CSS.
const cssOverride = new URLSearchParams(location.search).get("css");
if (cssOverride) {
  const style = document.createElement("style");
  style.textContent = cssOverride;
  document.head.append(style);
}
localStorage.clear();
localStorage.setItem("monocode.pacedReveal", "0");
localStorage.setItem("monocode.diffViewer", "unified");
localStorage.setItem("monocode.newLayoutPromptDismissed", "1");
localStorage.setItem(
  "monocode.recentProjects",
  JSON.stringify([
    { path: ALPHA, openedAt: Date.now() },
    { path: BETA, openedAt: Date.now() - 1000 },
    ...extraProjects.map((path, i) => ({ path, openedAt: Date.now() - 2000 - i })),
  ]),
);

// ?stream: the first session resumes mid-turn, so its output streams into a
// busy session the way a running agent's does.
if (new URLSearchParams(location.search).has("stream")) {
  const live = openAlpha[0] as Fixture & { busy?: boolean };
  live.busy = true;
  live.blocks = [
    ...live.blocks,
    { id: "live-user", role: "user", text: "Explain the sample while I review adjacent files." },
    { id: "live-answer", role: "assistant", text: "Review [sample.ts](sample.ts).\n\n", streaming: true } as Block,
  ];
}
const openSessions = [...openAlpha, ...openBeta];
const tabs = openSessions.map((session) => newTab(session.id));
const profilerCommits: { duration: number; at: number }[] = [];
const phaseWindow = { active: false, pending: false, style: 0, layout: 0 };
const { default: App } = await import("../../src/app/App");
// The harness queue the App owns is captured on its first flush, so output
// streams through the same queue, reducer and subscriptions as a provider.
const flushModule = await import("../../src/app/model/harnessFlush");
let appQueue: { enqueue: (id: string, event: unknown) => void; flush: () => void } | null = null;
const proto = flushModule.HarnessEventQueue.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
for (const name of ["flushMatching", "schedulePending", "visible", "schedule"]) {
  const original = proto[name];
  if (typeof original !== "function") continue;
  proto[name] = function (this: never, ...args: unknown[]) {
    appQueue ??= this;
    return original.apply(this, args);
  };
}

createRoot(document.getElementById("root")!).render(
  <Profiler
    id="workspace"
    onRender={(_id, _phase, duration, _base, _start, at) => {
      profilerCommits.push({ duration, at });
      // ?phases: after each commit inside a measured action, force style and
      // then layout so their engine cost can be attributed separately.
      if (phaseWindow.active && !phaseWindow.pending) {
        phaseWindow.pending = true;
        queueMicrotask(() => {
          phaseWindow.pending = false;
          const a = performance.now();
          void getComputedStyle(document.body).color;
          const b = performance.now();
          void document.documentElement.offsetHeight;
          const c = performance.now();
          phaseWindow.style += b - a;
          phaseWindow.layout += c - b;
        });
      }
    }}
  >
    <App
      resumed={{
        sessions: openSessions as never,
        tabs,
        activeTabId: tabs[0].id,
        projectCwd: ALPHA,
      }}
      history={all.filter((s) => s.cwd === ALPHA).map(summary) as never}
      historyCwd={ALPHA}
    />
  </Profiler>,
);

// --- Measurement helpers -----------------------------------------------------------
let inputAt = 0;
for (const type of ["keydown", "pointerdown", "mousedown"])
  window.addEventListener(type, () => (inputAt = performance.now()), true);

const marker = (id: string) => `MARK-${id}`;
const streaming = new Set<string>();
const painted = (id: string) => {
  const pane = document.querySelector<HTMLElement>(`[data-session-drop="${id}"]`);
  if (!pane || !pane.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
    return false;
  if (streaming.has(id)) {
    // A long stream can push the marker turn out of the rendered window;
    // the live reply itself must be on screen instead.
    const turns = pane.querySelectorAll("[data-transcript-turn]");
    const last = turns[turns.length - 1];
    const reply = last?.querySelector('[data-chat-message-role="assistant"]');
    return !!reply && reply.checkVisibility();
  }
  const heading = pane.querySelector("h3");
  return !!heading && heading.textContent?.includes(marker(id)) && heading.checkVisibility();
};
/** Resolve with ms from the last input event to the frame after `id` paints. */
const waitPainted = (id: string, timeout = 5000) =>
  new Promise<number>((resolve) => {
    const tick = () => {
      if (performance.now() - inputAt > timeout) return resolve(timeout);
      if (!painted(id)) return requestAnimationFrame(tick);
      requestAnimationFrame(() => resolve(performance.now() - inputAt));
    };
    requestAnimationFrame(tick);
  });

let streamTimer = 0;
let streamTick = 0;
const startStream = (id: string) => {
  const queue = appQueue;
  if (!queue) throw new Error("App harness queue not captured yet");
  clearInterval(streamTimer);
  streaming.add(id);
  streamTimer = window.setInterval(() => {
    queue.enqueue(id, {
      type: "message.delta",
      text:
        streamTick % 8 === 7
          ? "\n\n```typescript\nconst result = processItem(42);\n```\n\n"
          : "The sample remains visible while this reply grows. ".repeat(3),
    });
    streamTick++;
  }, 80);
};
const stopStream = (id: string) => {
  clearInterval(streamTimer);
  streaming.delete(id);
  appQueue?.enqueue(id, { type: "message.completed" });
  appQueue?.flush();
};

Object.assign(window, {
  bench: {
    commands,
    unknown,
    emit,
    listeners,
    profilerCommits,
    painted,
    waitPainted,
    startStream,
    stopStream,
    hasQueue: () => !!appQueue,
    markInput: () => (inputAt = performance.now()),
  },
});

// --- Self-driving mode for browsers without automation (WebKitGTK MiniBrowser) ---
// ?auto=s1,s2,s3 runs the scenarios with synthetic input and POSTs results to /result.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const findText = (text: string) =>
  [...document.querySelectorAll<HTMLElement>("body *")].find(
    (el) =>
      el.childElementCount === 0 &&
      el.textContent?.trim() === text &&
      el.checkVisibility(),
  );
const clickEl = (el: HTMLElement) => {
  const rect = el.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
    buttons: 1,
    view: window,
  };
  const pointer = { pointerId: 1, isPrimary: true, pointerType: "mouse" };
  inputAt = performance.now();
  el.dispatchEvent(new PointerEvent("pointerdown", { ...init, ...pointer }));
  el.dispatchEvent(new MouseEvent("mousedown", init));
  el.dispatchEvent(new PointerEvent("pointerup", { ...init, ...pointer, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("click", { ...init, buttons: 0 }));
};
const pressDigit = (digit: number) => {
  const init = {
    key: String(digit),
    code: `Digit${digit}`,
    metaKey: true,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  inputAt = performance.now();
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
};
/** Run `act`; resolve with input -> painted ms and React commit ms in that window. */
const forceLayout = new URLSearchParams(location.search).has("phases");
const measure = async (ids: string[], act: () => void, timeout = 5000) => {
  phaseWindow.active = forceLayout;
  phaseWindow.style = 0;
  phaseWindow.layout = 0;
  act();
  const start = inputAt;
  // ?phases: split the input's synchronous JS from the style+layout it left.
  const sync = performance.now() - start;
  let layout = 0;
  if (forceLayout) {
    const before = performance.now();
    void document.documentElement.offsetHeight;
    layout = performance.now() - before;
  }
  let hit: string | undefined;
  let frames = 0;
  let worst = 0;
  let last = performance.now();
  while (!(hit = ids.find((id) => painted(id)))) {
    await frame();
    frames++;
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
    if (now - start > timeout) break;
  }
  await frame();
  const end = performance.now();
  worst = Math.max(worst, end - last);
  const react = profilerCommits
    .filter((c) => c.at >= start - 1 && c.at <= end)
    .reduce((sum, c) => sum + c.duration, 0);
  phaseWindow.active = false;
  return {
    ms: hit ? end - start : timeout,
    react,
    sync,
    layout,
    frames,
    worst,
    commitStyle: phaseWindow.style,
    commitLayout: phaseWindow.layout,
  };
};
const autoParam = new URLSearchParams(location.search).get("auto");
if (autoParam !== null) {
  const post = (body: unknown) =>
    fetch("/result", { method: "POST", body: JSON.stringify(body) }).catch(() => undefined);
  const run = async () => {
    const started = performance.now();
    while (!painted("workspace-session-0")) {
      await sleep(100);
      if (performance.now() - started > 60000) throw new Error("app never painted");
    }
    await document.fonts.ready;
    // ?drop=<regex>: delete style rules whose selector matches, to find the
    // rules responsible for style recalculation cost.
    const drop = new URLSearchParams(location.search).get("drop");
    if (drop) {
      const pattern = new RegExp(drop);
      const dropped: string[] = [];
      const prune = (list: CSSRuleList, owner: CSSStyleSheet | CSSGroupingRule) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const rule = list[i];
          if (rule instanceof CSSStyleRule && pattern.test(rule.selectorText)) {
            dropped.push(rule.selectorText);
            owner.deleteRule(i);
          } else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules)
            prune((rule as CSSGroupingRule).cssRules, rule as CSSGroupingRule);
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          prune(sheet.cssRules, sheet);
        } catch {}
      }
      Object.assign(window, { benchDropped: dropped });
    }
    await sleep(2000);
    const settleMs = Number(new URLSearchParams(location.search).get("settle") ?? 600);
    const out: Record<string, unknown> = {
      ua: navigator.userAgent,
      dropped: (window as unknown as { benchDropped?: string[] }).benchDropped,
    };
    const scenarios = (autoParam || "s1,s2,s3").split(",");
    const streamed = scenarios.includes("s4") || scenarios.includes("s5");
    if (streamed) {
      if (!appQueue) {
        pressDigit(2);
        await sleep(500);
        pressDigit(1);
        await sleep(500);
      }
      startStream("workspace-session-0");
      await sleep(1500);
    }
    if (scenarios.includes("s4")) {
      // Idle cost while the visible session streams: frame gaps and commits.
      const gaps: number[] = [];
      const from = performance.now();
      let last = from;
      while (performance.now() - from < 10000) {
        await frame();
        const now = performance.now();
        gaps.push(now - last);
        last = now;
      }
      const commits = profilerCommits.filter((c) => c.at >= from);
      const fiber = (
        window as unknown as {
          benchFiber: { commits: { at: number; hits: Record<string, number> }[] };
        }
      ).benchFiber;
      const fc = fiber.commits.filter((c) => c.at >= from);
      const long = gaps.filter((g) => g > 50);
      out.s4 = {
        frames: gaps.length,
        longFrames: long.length,
        longFrameMs: long.reduce((a, b) => a + b, 0),
        worstFrame: Math.max(...gaps),
        commitsPerSec: commits.length / 10,
        reactMsPerSec: commits.reduce((a, c) => a + c.duration, 0) / 10,
        workspacePerSec: fc.filter((c) => c.hits.Workspace).length / 10,
        sidebarPerSec: fc.filter((c) => c.hits.SidebarComponent).length / 10,
      };
    }
    const tabs: unknown[] = [];
    if (scenarios.includes("s1") || scenarios.includes("s5"))
      for (let visit = 0; visit < 18; visit++) {
        const index = (visit + 1) % 6;
        tabs.push({
          visit,
          ...(await measure([`workspace-session-${index}`], () => pressDigit(index + 1))),
        });
        await sleep(settleMs);
      }
    out.s1 = tabs;
    const projects: unknown[] = [];
    if (scenarios.includes("s2") || scenarios.includes("s5"))
      for (let i = 0; i < 6; i++) {
        projects.push({
          to: "beta",
          ...(await measure(["beta-session-0", "beta-session-1"], () => clickEl(findText("beta")!))),
        });
        await sleep(settleMs);
        projects.push({
          to: "alpha",
          ...(await measure(openAlpha.map((s) => s.id), () => clickEl(findText("alpha")!))),
        });
        await sleep(settleMs);
      }
    out.s2 = projects;
    const opens: unknown[] = [];
    if (scenarios.includes("s3"))
      for (let k = 0; k < 6; k++) {
        const n = 12 - k;
        const row = findText(`Archive ${n}`);
        if (!row) {
          opens.push({ n, missing: true });
          continue;
        }
        row.scrollIntoView({ block: "center" });
        await sleep(300);
        opens.push({
          n,
          ...(await measure([`history-session-${n - 1}`], () => clickEl(row), 8000)),
        });
        await sleep(settleMs);
      }
    out.s3 = opens;
    if (streaming.size) stopStream("workspace-session-0");
    await post(out);
  };
  run().catch((error) => post({ error: String(error?.stack ?? error) }));
}
