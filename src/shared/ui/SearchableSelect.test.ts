// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LAYER } from "../lib/layers";
import { SearchableSelect } from "./SearchableSelect";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body
    .querySelectorAll("[data-dialog-popover]")
    .forEach((element) => element.parentElement?.remove());
  vi.unstubAllGlobals();
});

it("raises menus above a containing modal by default", async () => {
  await act(async () => {
    root.render(
      createElement(
        "div",
        { role: "dialog" },
        createElement(SearchableSelect, {
          label: "Agent",
          value: "codex",
          options: [
            { value: "codex", label: "Codex" },
            { value: "claude", label: "Claude" },
          ],
          onChange: vi.fn(),
        }),
      ),
    );
  });

  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  await act(async () => trigger.click());

  const menu = document.body.querySelector<HTMLElement>(
    '[aria-label="Agent options"]',
  );
  expect(menu).not.toBeNull();
  expect(menu!.parentElement!.style.zIndex).toBe(String(LAYER.dialogPopover));
});

it("does not scroll the page when a compact menu opens", async () => {
  const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  await act(async () => {
    root.render(
      createElement(SearchableSelect, {
        label: "Timeout",
        value: "60",
        variant: "pill",
        searchable: false,
        options: [
          { value: "30", label: "30 sec" },
          { value: "60", label: "1 min" },
          { value: "120", label: "2 min" },
          { value: "300", label: "5 min" },
        ],
        onChange: vi.fn(),
      }),
    );
  });

  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  await act(async () => trigger.click());
  await act(async () => {
    await Promise.resolve();
  });

  expect(scrollIntoView).not.toHaveBeenCalled();
  const option = document.body.querySelector('[role="option"]');
  expect(option?.className).toContain("h-7");
});

it("offers to create the typed entry when nothing matches it exactly", async () => {
  const onChange = vi.fn();
  const onCreate = vi.fn();
  await act(async () => {
    root.render(
      createElement(SearchableSelect, {
        label: "Branch",
        value: "main",
        options: [
          { value: "main", label: "main" },
          { value: "feature", label: "feature", detail: "origin" },
        ],
        onChange,
        create: { label: (name: string) => `Create branch ${name}`, onCreate },
      }),
    );
  });
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.body.textContent).toContain("origin");
  const input = document.body.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const type = async (text: string) =>
    act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

  await type("main");
  expect(document.body.textContent).not.toContain("Create branch");

  await type("new-work");
  expect(document.body.textContent).toContain("Create branch new-work");
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(onCreate).toHaveBeenCalledWith("new-work");
  expect(onChange).not.toHaveBeenCalled();
});
