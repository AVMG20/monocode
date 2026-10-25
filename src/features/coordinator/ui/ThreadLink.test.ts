// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { MarkdownLinkContext } from "../../sessions/ui/markdownLinks";
import type { ThreadView } from "../model/coordinator";
import {
  LiveThreadLink,
  publishThreadViews,
  ThreadLink,
  threadLinkId,
} from "./ThreadLink";

it("shows a coordinator's thread link as the thread, opening it on click", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onOpenThread = vi.fn();
  const view = {
    sessionId: "app-c-1",
    title: "Solar panel output balance",
    status: "solved",
  } as ThreadView;
  const render = (href: string, children: ReactNode) =>
    threadLinkId(href)
      ? createElement(ThreadLink, {
          view: threadLinkId(href) === view.sessionId ? view : undefined,
          onOpenThread,
          children,
        })
      : undefined;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        MarkdownLinkContext.Provider,
        { value: render },
        createElement(AgentMarkdown, {
          text: "Sent to [Solar balance](#thread-app-c-1), not [Gone](#thread-x) or [docs](https://example.com).",
        }),
      ),
    ),
  );
  const link = container.querySelector<HTMLElement>("[data-thread-link]");
  expect(link?.textContent).toBe("Solar panel output balance");
  await act(async () => link!.click());
  expect(onOpenThread).toHaveBeenCalledWith("app-c-1");
  expect(container.textContent).toContain("Gone");
  expect(container.querySelectorAll("a")).toHaveLength(1);
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps a live thread link in step with its thread", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const thread = (status: ThreadView["status"]) =>
    ({ sessionId: "t1", title: "Fix rounding", status }) as ThreadView;
  publishThreadViews(new Map([["p", [thread("busy")]]]));
  await act(async () =>
    root.render(
      createElement(LiveThreadLink, {
        sessionId: "t1",
        onOpenThread: () => {},
        children: "Fix rounding",
      }),
    ),
  );
  expect(container.querySelector("[data-thread-link]")).not.toBeNull();
  expect(container.querySelector("svg")).toBeNull();
  await act(async () =>
    publishThreadViews(new Map([["p", [thread("solved")]]])),
  );
  expect(container.querySelector("svg")).not.toBeNull();
  await act(async () => publishThreadViews(new Map()));
  expect(container.querySelector("[data-thread-link]")).toBeNull();
  expect(container.textContent).toBe("Fix rounding");
  act(() => root.unmount());
});
