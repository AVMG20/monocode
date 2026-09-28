// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { RunningSubagents } from "./RunningSubagents";

let container: HTMLDivElement;
let root: Root;

function run(id: string, title: string, patch: Partial<Block> = {}): Block {
  return {
    id,
    role: "tool",
    text: title,
    streaming: true,
    startedAt: 0,
    tool: { callId: id, title, kind: "agent", status: "in_progress" },
    ...patch,
  };
}

function render(props: ComponentProps<typeof RunningSubagents>) {
  act(() => root.render(createElement(RunningSubagents, props)));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(125_000);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RunningSubagents", () => {
  it("shows a pill per running subagent with its elapsed time", () => {
    render({
      blocks: [
        run("a", "Correctness review"),
        run("b", "Finished review", {
          streaming: false,
          tool: { callId: "b", kind: "agent", status: "completed" },
        }),
        { id: "c", role: "tool", text: "Read", tool: { kind: "read" } },
        run("d", "Style review", { startedAt: 65_000 }),
      ],
    });
    const pills = [
      ...container.querySelectorAll<HTMLElement>("[data-running-subagent]"),
    ];
    expect(pills.map((pill) => pill.textContent)).toEqual([
      "Correctness review2m 5s",
      "Style review1m",
    ]);
    act(() => vi.advanceTimersByTime(1000));
    expect(pills[1].textContent).toBe("Style review1m 1s");
  });

  it("ignores runs left in progress by an earlier turn", () => {
    render({
      blocks: [
        { id: "u1", role: "user", text: "first" },
        run("old", "Stale review"),
        { id: "u2", role: "user", text: "second" },
        run("new", "Live review"),
      ],
    });
    const pills = [
      ...container.querySelectorAll<HTMLElement>("[data-running-subagent]"),
    ];
    expect(pills.map((pill) => pill.dataset.runningSubagent)).toEqual(["new"]);
  });

  it("hides duplicate rows from older Claude task snapshots", () => {
    render({
      blocks: [
        { id: "u", role: "user", text: "Run four agents" },
        ...["Mail", "Customers", "SSO", "Key"].flatMap((name, index) => [
          run(`real_${index}`, name),
          run(`duplicate_${index}`, name, {
            tool: {
              callId: `agent:${name}`,
              kind: "agent",
              status: "in_progress",
            },
          }),
        ]),
      ],
    });
    expect(
      [
        ...container.querySelectorAll<HTMLElement>("[data-running-subagent]"),
      ].map((pill) => pill.textContent?.replace(/\d.*$/, "")),
    ).toEqual(["Mail", "Customers", "SSO", "Key"]);
  });

  it("renders nothing when no subagent is running and jumps to the row", () => {
    render({ blocks: [] });
    expect(container.querySelector("[data-running-subagents]")).toBeNull();
    const onSelect = vi.fn();
    render({ blocks: [run("a", "Review")], onSelect });
    act(() =>
      container.querySelector<HTMLElement>("[data-running-subagent]")!.click(),
    );
    expect(onSelect).toHaveBeenCalledWith("a");
  });
});
