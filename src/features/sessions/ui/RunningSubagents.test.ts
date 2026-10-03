// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { RunningSubagents, runningSubagents } from "./RunningSubagents";

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

function render(props: Partial<ComponentProps<typeof RunningSubagents>>) {
  act(() =>
    root.render(
      createElement(RunningSubagents, {
        runs: [],
        liveIds: new Set((props.runs ?? []).map((block) => block.id)),
        viewedId: null,
        onView: () => {},
        ...props,
      }),
    ),
  );
}

function rows() {
  return [...container.querySelectorAll<HTMLElement>("[aria-pressed]")];
}

const ids = (blocks: Block[]) => blocks.map((block) => block.id);

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

describe("runningSubagents", () => {
  it("lists only runs that have not reported back", () => {
    expect(
      ids(
        runningSubagents([
          run("a", "Correctness review"),
          run("b", "Finished review", {
            streaming: false,
            tool: { callId: "b", kind: "agent", status: "completed" },
          }),
          { id: "c", role: "tool", text: "Read", tool: { kind: "read" } },
          run("d", "Style review"),
        ]),
      ),
    ).toEqual(["a", "d"]);
  });

  it("ignores runs left in progress by an earlier turn", () => {
    expect(
      ids(
        runningSubagents([
          { id: "u1", role: "user", text: "first" },
          run("old", "Stale review"),
          { id: "u2", role: "user", text: "second" },
          run("new", "Live review"),
        ]),
      ),
    ).toEqual(["new"]);
  });

  it("keeps runs from the turn a steered message cut in on", () => {
    expect(
      ids(
        runningSubagents([
          { id: "u1", role: "user", text: "first" },
          run("old", "Stale review"),
          { id: "u2", role: "user", text: "second" },
          run("live", "Backend agent"),
          { id: "u3", role: "user", text: "and more", steered: true },
          run("new", "Frontend agent"),
        ]),
      ),
    ).toEqual(["live", "new"]);
  });

  it("hides duplicate rows from older Claude task snapshots", () => {
    const blocks: Block[] = [
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
    ];
    expect(ids(runningSubagents(blocks))).toEqual([
      "real_0",
      "real_1",
      "real_2",
      "real_3",
    ]);
  });
});

describe("RunningSubagents", () => {
  it("lists Main above a line per run with its elapsed time", () => {
    render({
      runs: [
        run("a", "Correctness review"),
        run("d", "Style review", { startedAt: 65_000 }),
      ],
    });
    expect(rows().map((row) => row.textContent)).toEqual([
      "Main2 subagents running",
      "Correctness review2m 5s",
      "Style review1m",
    ]);
    expect(rows()[0].getAttribute("aria-pressed")).toBe("true");
    act(() => vi.advanceTimersByTime(1000));
    expect(rows()[2].textContent).toBe("Style review1m 1s");
  });

  it("swaps to a run and back to Main", () => {
    const onView = vi.fn();
    render({ runs: [run("a", "Review")], onView });
    act(() => rows()[1].click());
    expect(onView).toHaveBeenLastCalledWith("a");

    render({ runs: [run("a", "Review")], viewedId: "a", onView });
    expect(rows()[0].getAttribute("aria-pressed")).toBe("false");
    expect(rows()[1].getAttribute("aria-pressed")).toBe("true");
    act(() => rows()[0].click());
    expect(onView).toHaveBeenLastCalledWith(null);
  });

  it("marks a viewed run that has finished or was stopped", () => {
    render({
      runs: [
        run("a", "Review", {
          streaming: false,
          tool: { callId: "a", kind: "agent", status: "completed" },
        }),
        run("b", "Stopped review"),
      ],
      liveIds: new Set(),
      viewedId: "a",
    });
    expect(rows().map((row) => row.textContent)).toEqual([
      "Main",
      "Reviewdone",
      "Stopped reviewstopped",
    ]);
  });

  it("stops a run that has a background task", () => {
    const onStop = vi.fn();
    render({
      runs: [run("a", "Review"), run("b", "Other")],
      stoppable: new Set(["a"]),
      onStop,
    });
    const stops = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label^="Stop "]',
    );
    expect(stops).toHaveLength(1);
    act(() => stops[0].click());
    expect(onStop).toHaveBeenCalledWith("a");
    expect(stops[0].textContent).toBe("Stopping…");
  });
});
