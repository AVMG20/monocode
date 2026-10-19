// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(props: { onSubmit: () => void; onRunBashCommand: (c: string) => void }) {
  await act(async () =>
    root.render(
      createElement(Composer, {
        focused: false,
        harness: "claude",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "~",
        hideTopBar: true,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        ...props,
      }),
    ),
  );
  return container.querySelector("textarea")!;
}

async function type(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    textarea.value = value;
    textarea.setSelectionRange(value.length, value.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  });
}

it("keeps the command and file pickers closed for a shell command", async () => {
  const textarea = await render({ onSubmit: vi.fn(), onRunBashCommand: vi.fn() });
  await type(textarea, "/");
  expect(container.textContent).toContain("/btw");
  await type(textarea, "!tree /");
  expect(container.textContent).not.toContain("/btw");
  expect(container.querySelector("[data-composer-bash]")).not.toBeNull();
});

it("runs a pasted shell command instead of starting a turn", async () => {
  const submit = vi.fn();
  const run = vi.fn();
  const textarea = await render({ onSubmit: submit, onRunBashCommand: run });
  await type(textarea, "!ls -la");
  await act(async () => {
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(run).toHaveBeenCalledWith("ls -la");
  expect(submit).not.toHaveBeenCalled();
  expect(textarea.value).toBe("");
});
