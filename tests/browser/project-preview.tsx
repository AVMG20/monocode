import { createRoot } from "react-dom/client";
import {
  newSession,
  type Block,
  type Session,
} from "../../src/features/sessions/model/session";
import { newTab } from "../../src/features/workspace/model/layout";
import "../../src/styles/index.css";

// A Claude Project with a coordinator and threads in each state, rendered
// through the real App with native services faked. For looking at the
// project UI in a browser: /tests/browser/project-preview.html
const root = "/fixture/shop";
const unknown = new Set<string>();
const invoke = async (command: string, args: Record<string, unknown> = {}) => {
  if (command === "plugin:event|listen") return 0;
  if (command === "plugin:event|unlisten") return;
  if (command === "session_get") {
    const id = String(args.sessionId);
    return all.find((session) => session.id === id) ?? null;
  }
  if (command === "session_list_by_project")
    return all
      .filter((session) => session.cwd === args.cwd)
      .map((session) => ({
        id: session.id,
        cwd: session.cwd,
        harness: session.harness,
        model: session.model,
        runtimeMode: session.runtimeMode,
        title: session.title,
        createdAt: 1,
        updatedAt: Date.now() - 60_000,
      }));
  if (command === "git_diff_stats")
    return { files: 2, additions: 14, deletions: 3 };
  if (command === "git_branch") return "main";
  if (command === "resource_usage")
    return { cpuPercent: 10, memoryPressure: 1 };
  unknown.add(command);
  return command.endsWith("_list") || command.startsWith("list_") ? [] : null;
};
Object.assign(window, {
  previewUnknownCommands: unknown,
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback: () => 0,
    invoke,
  },
});

const turn = (id: string, ask: string, reply: string): Block[] => [
  { id: `${id}-u`, role: "user", text: ask, startedAt: Date.now() - 600_000 },
  {
    id: `${id}-a`,
    role: "assistant",
    text: reply,
    startedAt: Date.now() - 590_000,
  },
];
const thread = (
  id: string,
  title: string,
  blocks: Block[],
  extra: Partial<Session> = {},
): Session => ({
  ...newSession("claude", root),
  id,
  title,
  blocks,
  ...extra,
});
const threads = [
  thread("thread-checkout", "Fix checkout rounding", [
    ...turn(
      "c1",
      "Totals are off by a cent on some carts. Find and fix it.",
      "Found it: `lineTotal` rounds each line before summing. I changed it to sum in cents and round once, and added a test with the failing cart.",
    ),
  ]),
  thread(
    "thread-search",
    "Speed up product search",
    [
      ...turn(
        "s1",
        "Search takes 2s on the catalog page. Make it fast.",
        "Profiling now. The query does a full scan on `products.name`.",
      ),
      {
        id: "s1-tool",
        role: "tool",
        text: "npm run bench:search",
        tool: { kind: "shell", status: "pending" },
      },
    ],
    { busy: true },
  ),
  thread("thread-deps", "Upgrade the payment SDK", [
    ...turn(
      "d1",
      "Upgrade the payment SDK to v5.",
      "The v5 migration renames `charge()` to `createPayment()`. Should I also move the webhooks to the new signature check?",
    ),
  ]),
  thread("thread-docs", "Write the API changelog", [
    ...turn(
      "k1",
      "Draft the changelog for 2.4.",
      "Done: CHANGELOG.md has the 2.4 section.",
    ),
  ]),
];
const coordinator = thread("project-chat", "Shop", [
  ...turn(
    "p1",
    "Totals are off by a cent sometimes, and search is slow.",
    "Two separate pieces of work, so two threads:\n\n- [Fix checkout rounding](#thread-thread-checkout)\n- [Speed up product search](#thread-thread-search)",
  ),
  ...turn(
    "p2",
    "Also upgrade the payment SDK.",
    "Started [Upgrade the payment SDK](#thread-thread-deps). It has a question for you about webhooks.",
  ),
]);
const all = [coordinator, ...threads];

localStorage.setItem("monocode.pacedReveal", "0");
localStorage.removeItem("monocode.insetLayout");
localStorage.setItem(
  "monocode:mono-roster",
  JSON.stringify([
    {
      id: "project-shop",
      kind: "project",
      name: "Shop",
      mascot: "cat",
      color: "hsl(200 70% 55%)",
      projects: [root],
      sessionId: coordinator.id,
    },
  ]),
);
localStorage.setItem(
  "monocode:coordinator-threads",
  JSON.stringify({
    "project-shop": threads.map((entry, index) => ({
      sessionId: entry.id,
      addedAt: Date.now() - (4 - index) * 3_600_000,
      ...(entry.id === "thread-docs" ? { resolvedAt: Date.now() - 1000 } : {}),
    })),
  }),
);
const params = new URLSearchParams(location.search);
if (params.has("open"))
  localStorage.setItem("monocode:open-mono", "project-shop");
else localStorage.removeItem("monocode:open-mono");

const plain = thread(
  "plain-session",
  "Plain session",
  turn("n1", "Hello", "Hi there."),
);
const tabs = [newTab(plain.id)];
const { default: App } = await import("../../src/app/App");
createRoot(document.getElementById("root")!).render(
  <App
    resumed={{
      sessions: [plain, ...all],
      tabs,
      activeTabId: tabs[0].id,
      projectCwd: root,
    }}
  />,
);
