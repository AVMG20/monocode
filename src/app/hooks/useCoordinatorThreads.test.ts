// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ThreadView } from "../../features/coordinator/model/coordinator";
import { listSessionsByProject } from "../../features/sessions/data/sessionStore";
import type { Session } from "../../features/sessions/model/session";
import { useCoordinatorThreads } from "./useCoordinatorThreads";

const roster = vi.hoisted(() => ({
  projects: [] as Array<{ id: string; projects: string[] }>,
  threads: {} as Record<string, Array<{ sessionId: string; addedAt: number }>>,
}));

vi.mock("../../features/monos/model/mono", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/monos/model/mono")>()),
  listCoordinatorProjects: () => roster.projects,
}));
vi.mock(
  "../../features/coordinator/model/coordinator",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../features/coordinator/model/coordinator")
    >()),
    listProjectThreads: (id: string) => roster.threads[id] ?? [],
  }),
);
vi.mock("../../features/sessions/data/sessionStore", async (original) => ({
  ...(await original<
    typeof import("../../features/sessions/data/sessionStore")
  >()),
  listSessionsByProject: vi.fn(async () => []),
}));

let container: HTMLDivElement;
let root: Root;
let latest: ReadonlyMap<string, ThreadView[]> | undefined;
let renders = 0;

function Probe({ sessions }: { sessions: Session[] }) {
  latest = useCoordinatorThreads(sessions, new Set(), "");
  renders += 1;
  return null;
}

function session(id: string, busy = false, text = "Done"): Session {
  return {
    id,
    title: id,
    cwd: "/repo",
    harness: "claude",
    model: "",
    modelSettings: {},
    runtimeMode: "supervised",
    busy,
    blocks: [{ id: `${id}-reply`, role: "assistant", text }],
  } as Session;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(listSessionsByProject).mockClear();
  roster.projects = [];
  roster.threads = {};
  latest = undefined;
  renders = 0;
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("stays idle without projects, whatever other sessions do", async () => {
  vi.useFakeTimers();
  await act(async () =>
    root.render(createElement(Probe, { sessions: [session("a")] })),
  );
  await act(async () =>
    root.render(createElement(Probe, { sessions: [session("a", true)] })),
  );
  const before = renders;
  await act(async () => vi.advanceTimersByTime(5 * 60_000));
  expect(renders).toBe(before);
  expect(listSessionsByProject).not.toHaveBeenCalled();
});

it("refetches summaries only when a thread starts or stops", async () => {
  roster.projects = [{ id: "p", projects: ["/repo"] }];
  roster.threads = { p: [{ sessionId: "t", addedAt: 1 }] };
  await act(async () =>
    root.render(
      createElement(Probe, { sessions: [session("t"), session("other")] }),
    ),
  );
  const calls = vi.mocked(listSessionsByProject).mock.calls.length;
  await act(async () =>
    root.render(
      createElement(Probe, {
        sessions: [session("t"), session("other", true)],
      }),
    ),
  );
  expect(vi.mocked(listSessionsByProject).mock.calls.length).toBe(calls);
  await act(async () =>
    root.render(
      createElement(Probe, {
        sessions: [session("t", true), session("other", true)],
      }),
    ),
  );
  expect(vi.mocked(listSessionsByProject).mock.calls.length).toBe(calls + 1);
});

it("updates a thread's view when its session changes", async () => {
  roster.projects = [{ id: "p", projects: ["/repo"] }];
  roster.threads = { p: [{ sessionId: "t", addedAt: 1 }] };
  const first = session("t", false, "First answer");
  await act(async () =>
    root.render(createElement(Probe, { sessions: [first] })),
  );
  expect(latest?.get("p")?.[0].activity).toBe("First answer");
  await act(async () =>
    root.render(createElement(Probe, { sessions: [first] })),
  );
  expect(latest?.get("p")?.[0].activity).toBe("First answer");
  await act(async () =>
    root.render(
      createElement(Probe, {
        sessions: [session("t", false, "Second answer")],
      }),
    ),
  );
  expect(latest?.get("p")?.[0].activity).toBe("Second answer");
});
