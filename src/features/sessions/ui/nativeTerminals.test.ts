// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const spawn = {
    resolve: (_value: { resumed: boolean; promptDelivered: boolean }) => {},
    reject: (_error: unknown) => {},
  };
  return {
    spawn,
    spawnNativeSession: vi.fn(
      () =>
        new Promise<{ resumed: boolean; promptDelivered: boolean }>(
          (resolve, reject) => {
            spawn.resolve = resolve;
            spawn.reject = reject;
          },
        ),
    ),
    writePty: vi.fn(async () => undefined),
    killPty: vi.fn(async () => undefined),
    exit: new Map<string, (code: number | null) => void>(),
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    element = null;
    buffer = {
      active: { type: "normal" },
      onBufferChange: () => ({ dispose() {} }),
    };
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    open() {}
    write() {}
    writeln() {}
    focus() {}
    refresh() {}
    dispose() {}
    paste() {}
    clear() {}
    input() {}
    getSelection() {
      return "";
    }
    hasSelection() {
      return false;
    }
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler() {}
    onData() {
      return { dispose() {} };
    }
    onTitleChange() {
      return { dispose() {} };
    }
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("../../../platform/tauri/pty", () => ({
  killPty: mocks.killPty,
  resizePty: vi.fn(async () => undefined),
  writePty: mocks.writePty,
  subscribePty: (
    id: string,
    _onData: unknown,
    onExit: (code: number | null) => void,
  ) => {
    mocks.exit.set(id, onExit);
    return () => undefined;
  },
}));
vi.mock("../../../platform/tauri/nativeSession", () => ({
  spawnNativeSession: mocks.spawnNativeSession,
  subscribeNativeSessionStatus: () => () => undefined,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: () => Promise.resolve(() => undefined),
  }),
}));
vi.mock("../../terminal/model/terminalLayout", () => ({
  fitTerminal: () => ({ cols: 80, rows: 24 }),
}));
vi.mock("../../terminal/ui/TerminalView", () => ({
  monoFont: () => "monospace",
  oscColors: () => ({ fg: "#fff", bg: "#000", cursor: "#fff" }),
  terminalTheme: () => ({}),
}));

import {
  deliverNativePrompt,
  disposeNativeTerminal,
  droppedPathText,
  setNativeInitialPrompt,
  startNativeTerminal,
} from "./nativeTerminals";

const launch = {
  cwd: "/repo",
  provider: "claude" as const,
  conversationId: "9b3c1f0e-0000-4000-8000-000000000001",
};

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function start(id: string) {
  startNativeTerminal(id, launch);
  // The first fit runs on the next animation frame and spawns.
  vi.runOnlyPendingTimers();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    setTimeout(() => fn(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.spawnNativeSession.mockClear();
  mocks.writePty.mockClear();
  mocks.killPty.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("native terminal prompts", () => {
  it("has no CLI to hand a prompt to before one starts", () => {
    expect(deliverNativePrompt("none", "hi")).toBe("none");
  });

  it("queues prompts while the CLI starts and types them once it is up", async () => {
    start("a");
    expect(mocks.spawnNativeSession).toHaveBeenCalledTimes(1);
    expect(deliverNativePrompt("a", "first")).toBe("queued");
    mocks.spawn.resolve({ resumed: false, promptDelivered: false });
    await flush();
    expect(mocks.writePty).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    await flush();
    expect(mocks.writePty).toHaveBeenCalledWith("a", "\x1b[200~first\x1b[201~");
    expect(deliverNativePrompt("a", "second\x1b[201~rm -rf")).toBe("sent");
    await flush();
    // Escapes are stripped so a prompt cannot close the paste early.
    expect(mocks.writePty).toHaveBeenCalledWith(
      "a",
      "\x1b[200~second[201~rm -rf\x1b[201~",
    );
    disposeNativeTerminal("a");
  });

  it("clears an exited CLI so the caller starts a new one", async () => {
    start("b");
    mocks.spawn.resolve({ resumed: true, promptDelivered: false });
    await flush();
    mocks.exit.get("b")?.(0);
    expect(deliverNativePrompt("b", "hello")).toBe("none");
    // The next start spawns again rather than reusing the dead terminal.
    start("b");
    expect(mocks.spawnNativeSession).toHaveBeenCalledTimes(2);
    disposeNativeTerminal("b");
  });

  it("stops a CLI that finishes starting after its session was closed", async () => {
    start("c");
    disposeNativeTerminal("c");
    mocks.spawn.resolve({ resumed: false, promptDelivered: true });
    await flush();
    expect(mocks.killPty).toHaveBeenCalledWith("c");
  });

  it("keeps the first prompt for the next try when the launch fails", async () => {
    setNativeInitialPrompt("d", "build it");
    start("d");
    expect(mocks.spawnNativeSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialPrompt: "build it" }),
    );
    mocks.spawn.reject(new Error("not installed"));
    await flush();
    disposeNativeTerminal("d");
    start("d");
    expect(mocks.spawnNativeSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ initialPrompt: "build it" }),
    );
    disposeNativeTerminal("d");
  });
});

describe("droppedPathText", () => {
  it("escapes shell specials like a macOS terminal drop", () => {
    expect(
      droppedPathText("/Users/me/Desktop/Screen Shot (1).png", false),
    ).toBe("/Users/me/Desktop/Screen\\ Shot\\ \\(1\\).png");
    expect(droppedPathText("/tmp/plain-file_1.png", false)).toBe(
      "/tmp/plain-file_1.png",
    );
  });

  it("keeps letters of any script and escapes shell specials", () => {
    expect(droppedPathText("/tmp/café 写真.png", false)).toBe(
      "/tmp/café\\ 写真.png",
    );
    // macOS screenshot names use U+202F before AM/PM; terminals leave it.
    expect(droppedPathText("/tmp/Shot 10.00.00\u202fPM.png", false)).toBe(
      "/tmp/Shot\\ 10.00.00\u202fPM.png",
    );
    expect(droppedPathText("/tmp/~a#b'c\"d$e`f\\g", false)).toBe(
      "/tmp/\\~a\\#b\\'c\\\"d\\$e\\`f\\\\g",
    );
  });

  it("quotes paths with spaces on Windows", () => {
    expect(droppedPathText("C:\\Users\\me\\My Pics\\a.png", true)).toBe(
      '"C:\\Users\\me\\My Pics\\a.png"',
    );
    expect(droppedPathText("C:\\tmp\\a.png", true)).toBe("C:\\tmp\\a.png");
  });
});
