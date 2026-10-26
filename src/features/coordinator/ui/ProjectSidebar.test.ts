// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ThreadView } from "../model/coordinator";
import {
  projectItemOrder,
  projectThreadGroups,
  ProjectSidebar,
} from "./ProjectSidebar";

const view = (
  sessionId: string,
  status: ThreadView["status"],
  addedAt: number,
  updatedAt: number,
): ThreadView => ({
  sessionId,
  title: `Thread ${sessionId}`,
  status,
  addedAt,
  updatedAt,
});

const views = [
  view("old-busy", "busy", 1, 900),
  view("new-busy", "busy", 2, 100),
  view("asks", "waiting", 3, 50),
  view("idle-old", "inactive", 4, 10),
  view("idle-new", "inactive", 5, 20),
  view("done", "solved", 6, 30),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps working threads in start order and the rest by latest activity", () => {
  const groups = projectThreadGroups(views);
  // A streaming thread's activity moves every block; its row must not.
  expect(groups.busy.map((entry) => entry.sessionId)).toEqual([
    "new-busy",
    "old-busy",
  ]);
  expect(groups.inactive.map((entry) => entry.sessionId)).toEqual([
    "idle-new",
    "idle-old",
  ]);
});

it("steps through the chat, then each shown thread, skipping folded groups", () => {
  const collapsed = {
    waiting: false,
    busy: false,
    inactive: false,
    solved: true,
  };
  expect(projectItemOrder(views, collapsed)).toEqual([
    null,
    "asks",
    "new-busy",
    "old-busy",
    "idle-new",
    "idle-old",
  ]);
});

it("lists the chat and the threads by group, and picks either", async () => {
  const onSelectChat = vi.fn();
  const onSelectThread = vi.fn();
  const onResolve = vi.fn();
  await act(async () =>
    root.render(
      createElement(ProjectSidebar, {
        name: "Shop",
        look: { mascot: "cat", color: "#6ba" },
        chatStatus: "idle",
        chatUnseen: false,
        views,
        activeThreadId: "asks",
        onSelectChat,
        onSelectThread,
        onResolve,
        onOpenInTab: vi.fn(),
        onNewThread: vi.fn(),
        onOpenSettings: vi.fn(),
      }),
    ),
  );
  const groups = [...container.querySelectorAll("[data-thread-group]")].map(
    (group) => group.getAttribute("data-thread-group"),
  );
  expect(groups).toEqual(["waiting", "busy", "inactive", "solved"]);
  // Solved starts folded.
  expect(container.querySelector('[data-thread-row="done"]')).toBeNull();
  expect(
    container
      .querySelector('[data-thread-row="asks"] button')!
      .getAttribute("aria-current"),
  ).toBe("true");
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[data-thread-row="idle-old"] button')!
      .click(),
  );
  expect(onSelectThread).toHaveBeenCalledWith("idle-old");
  act(() =>
    container.querySelector<HTMLButtonElement>("[data-project-chat]")!.click(),
  );
  expect(onSelectChat).toHaveBeenCalledOnce();
  act(() =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Mark solved: Thread idle-old"]',
      )!
      .click(),
  );
  expect(onResolve).toHaveBeenCalledWith("idle-old", true);
});
