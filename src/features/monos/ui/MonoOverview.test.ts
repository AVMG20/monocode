// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoOverview, type MonoOverviewTab } from "./MonoOverview";

vi.mock("./MonoChangesView", () => ({
  MonoChangesView: () => createElement("p", { "data-changes-view": "" }),
}));

let container: HTMLDivElement;
let root: Root;

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

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(
  tab: MonoOverviewTab,
  onTabChange = vi.fn(),
  extra: Record<string, unknown> = {},
) {
  await act(async () =>
    root.render(
      createElement(MonoOverview, {
        open: true,
        agent: { name: "Broski", mascot: "cat", color: "#9c9", projects: [] },
        documents: [{ id: "d1", kind: "document", title: "Plan" }],
        tab,
        onTabChange,
        onOpenDocument: vi.fn(),
        onClose: vi.fn(),
        ...extra,
      }),
    ),
  );
  return onTabChange;
}

function tabs() {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

it("names only the open tab, with its count, and switches tabs", async () => {
  const onTabChange = await render("documents");
  const labels = tabs().map((tab) =>
    tab.querySelector("[data-tab-label]")!.getAttribute("data-tab-label"),
  );
  expect(labels).toEqual(["open", "closed"]);
  // Threads have the project sidebar, not a tab here.
  expect(tabs().map((tab) => tab.getAttribute("aria-label"))).toEqual([
    "Documents",
    "Changes",
  ]);
  expect(tabs()[0].textContent).toBe("Documents1");
  expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  act(() => tabs()[1].click());
  expect(onTabChange).toHaveBeenCalledWith("changes");
});

it("toggles activity from beside the panel toggle", async () => {
  const onTabChange = await render("documents");
  const button = () =>
    container.querySelector<HTMLButtonElement>(
      '[aria-label="Show activity"], [aria-label="Hide activity"]',
    )!;
  expect(button().getAttribute("aria-pressed")).toBe("false");
  expect(
    button().querySelector("[data-tab-label]")!.getAttribute("data-tab-label"),
  ).toBe("closed");
  act(() => button().click());
  expect(onTabChange).toHaveBeenLastCalledWith("activity");
  await render("activity", onTabChange);
  expect(button().getAttribute("aria-label")).toBe("Hide activity");
  expect(button().getAttribute("aria-pressed")).toBe("true");
  expect(
    button().querySelector("[data-tab-label]")!.getAttribute("data-tab-label"),
  ).toBe("open");
  expect(button().textContent).toBe("Activity");
  act(() => button().click());
  expect(onTabChange).toHaveBeenLastCalledWith("documents");
});

it("shows the picked turn's activity, or how to pick one", async () => {
  await render("activity");
  const panel = container.querySelector('[data-mono-overview="activity"]')!;
  expect(panel.textContent).toContain(
    "Select the activity on one of Broski's messages",
  );
  await render("activity", vi.fn(), {
    activity: createElement("p", { "data-trail": "" }, "Steps"),
  });
  expect(panel.querySelector("[data-trail]")?.textContent).toBe("Steps");
  expect(panel.textContent).not.toContain("Select the activity");
});

const changes = (totals: unknown) => ({
  changes: {
    sessionId: "mono",
    cwd: "/home",
    totals,
    request: {},
    projects: [],
  },
});

it("always offers a Changes tab and keeps its view mounted once opened", async () => {
  await render("documents", vi.fn(), changes(null));
  expect(tabs()[1].getAttribute("aria-label")).toBe("Changes");
  expect(container.querySelector("[data-changes-view]")).toBeNull();
  const onTabChange = vi.fn();
  await render(
    "changes",
    onTabChange,
    changes({ files: 3, additions: 12, deletions: 4 }),
  );
  expect(tabs()[1].textContent).toBe("Changes3");
  expect(container.querySelector("[data-changes-view]")).not.toBeNull();
  // Another tab keeps the view mounted, hidden, so a commit draft survives.
  await render("documents", onTabChange, changes(null));
  expect(tabs()[1].getAttribute("aria-label")).toBe("Changes");
  expect(
    container.querySelector("[data-changes-view]")!.closest("[hidden]"),
  ).not.toBeNull();
});

it("dots the folded Changes icon while there are changes", async () => {
  await render("documents", vi.fn(), changes(null));
  expect(tabs()[1].querySelector("[data-changes-dot]")).toBeNull();
  await render(
    "sessions",
    vi.fn(),
    changes({ files: 2, additions: 3, deletions: 1 }),
  );
  expect(tabs()[1].querySelector("[data-changes-dot]")).not.toBeNull();
  // Open, the tab names its count instead.
  await render(
    "changes",
    vi.fn(),
    changes({ files: 2, additions: 3, deletions: 1 }),
  );
  expect(tabs()[1].querySelector("[data-changes-dot]")).toBeNull();
});

it("shows documents in their own tab", async () => {
  await render("documents");
  expect(container.querySelector('[data-mono-document="d1"]')).not.toBeNull();
});

it("opens a document over its tab with a way back", async () => {
  const onBackFromDocument = vi.fn();
  await render("documents", vi.fn(), {
    shownDocumentId: "d1",
    onBackFromDocument,
  });
  const page = container.querySelector("[data-mono-document-page]")!;
  expect(page).not.toBeNull();
  act(() =>
    page.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!.click(),
  );
  expect(onBackFromDocument).toHaveBeenCalledOnce();
});
