// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import type { Block } from "../../sessions/model/session";
import {
  addProjectThread,
  AUTO_RESOLVE_MS,
  COORDINATOR_ROTATE_TOKENS,
  coordinatorOverBudget,
  forgetProjectThreads,
  groupThreads,
  listProjectThreads,
  projectForThread,
  projectThreadsSnapshot,
  removeProjectThread,
  resolveProjectThread,
  subscribeProjectThreads,
  threadsBrief,
  threadView,
  type ProjectThread,
  type ThreadView,
} from "./coordinator";

const THREADS_KEY = "monocode:coordinator-threads";
let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

type LiveSession = NonNullable<Parameters<typeof threadView>[0]["session"]>;

const NOW = 1_800_000_000_000;

function live(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    id: "s1",
    title: "Fix login",
    blocks: [],
    busy: false,
    harness: "claude",
    model: "opus",
    ...overrides,
  };
}

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    cwd: "/repo",
    harness: "claude",
    model: "opus",
    runtimeMode: "default",
    title: "Saved title",
    createdAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    ...overrides,
  } as SessionSummary;
}

const thread = (overrides: Partial<ProjectThread> = {}): ProjectThread => ({
  sessionId: "s1",
  addedAt: NOW - 60_000,
  ...overrides,
});

function view(overrides: Partial<ThreadView>): ThreadView {
  return {
    sessionId: "s",
    title: "Thread",
    status: "inactive",
    updatedAt: NOW,
    ...overrides,
  };
}

describe("thread registry", () => {
  it("adds a thread once and keeps the first time it was added", () => {
    addProjectThread("p1", "a", 100);
    addProjectThread("p1", "a", 200);
    addProjectThread("p1", "b", 300);
    expect(listProjectThreads("p1")).toEqual([
      { sessionId: "a", addedAt: 100 },
      { sessionId: "b", addedAt: 300 },
    ]);
    expect(listProjectThreads("p2")).toEqual([]);
  });

  it("marks a thread solved and opens it again", () => {
    addProjectThread("p1", "a", 100);
    resolveProjectThread("p1", "a", true, 500);
    expect(listProjectThreads("p1")).toEqual([
      { sessionId: "a", addedAt: 100, resolvedAt: 500 },
    ]);
    // Solving it again keeps the first time.
    resolveProjectThread("p1", "a", true, 900);
    expect(listProjectThreads("p1")[0].resolvedAt).toBe(500);
    resolveProjectThread("p1", "a", false);
    expect(listProjectThreads("p1")).toEqual([
      { sessionId: "a", addedAt: 100 },
    ]);
  });

  it("only announces real changes", () => {
    const onChange = vi.fn();
    const stop = subscribeProjectThreads(onChange);
    addProjectThread("p1", "a", 100);
    expect(onChange).toHaveBeenCalledTimes(1);
    addProjectThread("p1", "a", 100);
    resolveProjectThread("p1", "a", false);
    resolveProjectThread("p1", "missing", true);
    removeProjectThread("missing");
    forgetProjectThreads("unknown");
    expect(onChange).toHaveBeenCalledTimes(1);
    const before = projectThreadsSnapshot();
    resolveProjectThread("p1", "a", true, 200);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(projectThreadsSnapshot()).not.toBe(before);
    stop();
    removeProjectThread("a");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("finds a thread's project and drops a thread from it", () => {
    addProjectThread("p1", "a");
    addProjectThread("p2", "b");
    expect(projectForThread("a")).toBe("p1");
    expect(projectForThread("b")).toBe("p2");
    expect(projectForThread("c")).toBeUndefined();
    removeProjectThread("a");
    expect(projectForThread("a")).toBeUndefined();
    expect(listProjectThreads("p1")).toEqual([]);
    expect(listProjectThreads("p2")).toHaveLength(1);
  });

  it("forgets every thread of a removed project", () => {
    addProjectThread("p1", "a");
    addProjectThread("p1", "b");
    forgetProjectThreads("p1");
    expect(listProjectThreads("p1")).toEqual([]);
    expect(projectForThread("a")).toBeUndefined();
  });

  it("reads past damaged storage", () => {
    stored.set(THREADS_KEY, "not json");
    expect(listProjectThreads("p1")).toEqual([]);
    stored.set(
      THREADS_KEY,
      JSON.stringify({
        p1: [
          { sessionId: "a", addedAt: 5, resolvedAt: "soon" },
          { sessionId: "" },
          null,
          { sessionId: "b" },
        ],
        p2: "nope",
      }),
    );
    expect(listProjectThreads("p1")).toEqual([
      { sessionId: "a", addedAt: 5 },
      { sessionId: "b", addedAt: 0 },
    ]);
    expect(listProjectThreads("p2")).toEqual([]);
    stored.set(THREADS_KEY, "[1,2]");
    expect(listProjectThreads("p1")).toEqual([]);
  });
});

describe("threadView", () => {
  const question = {
    requestId: 1,
    title: "Which database?",
    questions: [],
  };

  it("needs the user above everything, even once solved", () => {
    const result = threadView({
      thread: thread({ resolvedAt: NOW }),
      session: live({ busy: true, pendingQuestion: question }),
      summary: summary({ archived: true }),
      now: NOW,
    });
    expect(result.status).toBe("waiting");
    expect(result.activity).toBe("Which database?");
  });

  it("is busy while working, even once solved or auto-resolved", () => {
    const blocks: Block[] = [
      { id: "u", role: "user", text: "go" },
      {
        id: "t",
        role: "assistant",
        text: "",
        tool: { title: "Run `npm test`" },
      },
    ];
    const result = threadView({
      thread: thread({ resolvedAt: NOW, addedAt: 0 }),
      session: live({ busy: true, blocks }),
      now: NOW + AUTO_RESOLVE_MS * 2,
    });
    expect(result).toMatchObject({ status: "busy", activity: "Run npm test" });
  });

  it("is solved when marked or archived, and when left inactive for a day", () => {
    expect(
      threadView({
        thread: thread({ resolvedAt: NOW }),
        session: live(),
        unseen: true,
        now: NOW,
      }),
    ).toMatchObject({ status: "solved", unseen: true });
    expect(
      threadView({
        thread: thread(),
        summary: summary({ archived: true }),
        now: NOW,
      }).status,
    ).toBe("solved");
    const quiet = {
      thread: thread({ addedAt: NOW - AUTO_RESOLVE_MS - 1 }),
      summary: summary({ updatedAt: NOW - AUTO_RESOLVE_MS - 1 }),
      now: NOW,
    };
    expect(threadView(quiet).status).toBe("solved");
    // An unread reply still waits for the user, however old.
    expect(threadView({ ...quiet, unseen: true }).status).toBe("waiting");
    const recent = threadView({
      thread: thread({ addedAt: NOW - AUTO_RESOLVE_MS }),
      summary: summary({ updatedAt: NOW - AUTO_RESOLVE_MS }),
      now: NOW,
    });
    expect(recent.status).toBe("inactive");
  });

  it("waits for review after a turn the user has not seen", () => {
    expect(
      threadView({ thread: thread(), session: live(), unseen: true, now: NOW }),
    ).toMatchObject({ status: "waiting", activity: "Ready for review" });
    const replied = threadView({
      thread: thread(),
      session: live({
        blocks: [
          { id: "u", role: "user", text: "fix it" },
          {
            id: "a",
            role: "assistant",
            text: "Fixed the **login** bug.\n\nDetails follow.",
          },
        ],
      }),
      unseen: true,
      now: NOW,
    });
    expect(replied).toMatchObject({
      status: "waiting",
      activity: "Fixed the login bug.",
    });
  });

  it("is inactive otherwise, with the last reply as its activity", () => {
    const result = threadView({
      thread: thread(),
      session: live({
        blocks: [
          { id: "a1", role: "assistant", text: "Earlier reply" },
          { id: "u", role: "user", text: "next" },
          { id: "i", role: "user", text: "status ping", internal: true },
          { id: "a2", role: "assistant", text: "Latest reply" },
          { id: "s", role: "assistant", text: "partial", streaming: true },
        ],
      }),
      now: NOW,
    });
    expect(result).toMatchObject({
      status: "inactive",
      activity: "Latest reply",
    });
    // No reply after the user's last message: nothing to show.
    expect(
      threadView({
        thread: thread(),
        session: live({
          blocks: [
            { id: "a", role: "assistant", text: "Old" },
            { id: "u", role: "user", text: "new question" },
          ],
        }),
        now: NOW,
      }).activity,
    ).toBeUndefined();
  });

  it("takes the title, look and time from the session or its summary", () => {
    const fromSummary = threadView({
      thread: thread({ addedAt: NOW - 5_000 }),
      summary: summary({
        title: " Saved ",
        branch: "feat/x",
        additions: 3,
        deletions: 1,
        updatedAt: NOW - 1_000,
      }),
      now: NOW,
    });
    expect(fromSummary).toMatchObject({
      title: "Saved",
      branch: "feat/x",
      additions: 3,
      deletions: 1,
      updatedAt: NOW - 1_000,
    });
    expect(fromSummary.unseen).toBeUndefined();
    const fromSession = threadView({
      thread: thread({ addedAt: NOW - 5_000 }),
      session: live({
        title: "  ",
        branch: "main",
        blocks: [{ id: "u", role: "user", text: "x", startedAt: NOW - 10 }],
      }),
      summary: summary({ title: "Saved", updatedAt: NOW - 1_000 }),
      now: NOW,
    });
    expect(fromSession).toMatchObject({
      title: "Saved",
      branch: "main",
      updatedAt: NOW - 10,
    });
    expect(threadView({ thread: thread(), now: NOW }).title).toBe(
      "Untitled thread",
    );
  });
});

describe("groupThreads", () => {
  it("sorts each status most recent first", () => {
    const groups = groupThreads([
      view({ sessionId: "a", status: "busy", updatedAt: 1 }),
      view({ sessionId: "b", status: "busy", updatedAt: 3 }),
      view({ sessionId: "c", status: "solved", updatedAt: 2 }),
      view({ sessionId: "d", status: "busy", updatedAt: 2 }),
    ]);
    expect(groups.busy.map((entry) => entry.sessionId)).toEqual([
      "b",
      "d",
      "a",
    ]);
    expect(groups.solved.map((entry) => entry.sessionId)).toEqual(["c"]);
    expect(groups.waiting).toEqual([]);
    expect(groups.inactive).toEqual([]);
  });
});

describe("threadsBrief", () => {
  it("says there are no threads yet", () => {
    expect(threadsBrief([])).toBe(
      "<project_threads>\n(No threads yet. Start one with app sessions.start when there is work to do.)\n</project_threads>",
    );
  });

  it("lists threads by status with branch and activity", () => {
    expect(
      threadsBrief([
        view({
          sessionId: "s2",
          title: "Inactive one",
          status: "inactive",
          updatedAt: 5,
        }),
        view({
          sessionId: "s1",
          title: "Fix `login`",
          status: "waiting",
          branch: "fix/login",
          activity: "Approve **Bash**\nnow",
        }),
      ]),
    ).toBe(
      [
        "<project_threads>",
        '- s1 · Waiting for you · "Fix login" [fix/login] — Approve Bash now',
        '- s2 · Inactive · "Inactive one"',
        "</project_threads>",
      ].join("\n"),
    );
  });

  it("lists only the five latest solved threads", () => {
    const solved = Array.from({ length: 7 }, (_, index) =>
      view({ sessionId: `s${index}`, status: "solved", updatedAt: index }),
    );
    const brief = threadsBrief(solved);
    expect(brief.match(/^- /gm)).toHaveLength(5);
    expect(brief).toContain("- s6 ·");
    expect(brief).not.toContain("- s1 ·");
    expect(brief).toContain("(2 older solved threads not listed;");
  });
});

describe("coordinatorOverBudget", () => {
  it("rotates only a provider session past the token budget or 80% full", () => {
    expect(coordinatorOverBudget({})).toBe(false);
    expect(
      coordinatorOverBudget({ context: { used: COORDINATOR_ROTATE_TOKENS } }),
    ).toBe(false);
    expect(
      coordinatorOverBudget({
        providerSessionId: "p",
        context: { used: COORDINATOR_ROTATE_TOKENS },
      }),
    ).toBe(true);
    expect(
      coordinatorOverBudget({
        providerSessionId: "p",
        context: { used: 40_000, window: 50_000 },
      }),
    ).toBe(true);
    expect(
      coordinatorOverBudget({
        providerSessionId: "p",
        context: { used: 39_000, window: 50_000 },
      }),
    ).toBe(false);
    expect(
      coordinatorOverBudget({
        providerSessionId: "p",
        context: { used: 50_000 },
      }),
    ).toBe(false);
  });
});
