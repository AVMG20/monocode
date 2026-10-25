import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  listProjectThreads,
  projectThreadsSnapshot,
  resolveProjectThread,
  subscribeProjectThreads,
  threadView,
  type ThreadSteps,
  type ThreadView,
} from "../../features/coordinator/model/coordinator";
import { listCoordinatorProjects } from "../../features/monos/model/mono";
import { plainEqual, useStableValue } from "../../shared/hooks/useStableValue";
import {
  listSessionsByProject,
  type SessionSummary,
} from "../../features/sessions/data/sessionStore";
import type { Session } from "../../features/sessions/model/session";

const REFRESH_MS = 60_000;

/**
 * Every project's threads and where each stands. Live sessions decide from
 * their state; the rest from their saved summaries, which reload when a
 * thread starts or stops working and once a minute for the time-based
 * statuses.
 */
export function useCoordinatorThreads(
  sessions: readonly Session[],
  unseenFinishedIds: ReadonlySet<string>,
  monosSnap: string,
): ReadonlyMap<string, ThreadView[]> {
  const registrySnap = useSyncExternalStore(
    subscribeProjectThreads,
    projectThreadsSnapshot,
  );
  // The roster and registry are read through their snapshots.
  const projects = useMemo(() => listCoordinatorProjects(), [monosSnap]);
  const registry = useMemo(
    () =>
      new Map(
        projects.map((project) => [project.id, listProjectThreads(project.id)]),
      ),
    [projects, registrySnap],
  );
  const threadIds = useMemo(
    () =>
      new Set([...registry.values()].flat().map((thread) => thread.sessionId)),
    [registry],
  );
  // Only threads starting or stopping refetch summaries, not every session.
  const busyKey = sessions
    .filter((session) => session.busy && threadIds.has(session.id))
    .map((session) => session.id)
    .sort()
    .join(",");
  const [summaries, setSummaries] = useState<
    ReadonlyMap<string, SessionSummary>
  >(() => new Map());
  // Minute-coarse clock: statuses only compare against days of inactivity,
  // and a stable `now` lets unchanged threads reuse their views.
  const [now, setNow] = useState(() => Date.now());
  const lastKnown = useRef(
    new Map<string, { steps?: ThreadSteps; activity?: string }>(),
  );
  const viewCache = useRef(
    new Map<string, { inputs: readonly unknown[]; view: ThreadView }>(),
  );

  const hasThreads = threadIds.size > 0;
  useEffect(() => {
    if (!hasThreads) return;
    const timer = window.setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hasThreads]);

  useEffect(() => {
    let cancelled = false;
    const folders = new Set(
      projects.flatMap((project) => project.projects.slice(0, 1)),
    );
    if (!threadIds.size) {
      setSummaries((current) => (current.size ? new Map() : current));
      return;
    }
    void Promise.all(
      [...folders].map((folder) =>
        listSessionsByProject(folder).catch(() => [] as SessionSummary[]),
      ),
    ).then((lists) => {
      if (cancelled) return;
      const next = new Map<string, SessionSummary>();
      for (const summary of lists.flat())
        if (threadIds.has(summary.id)) next.set(summary.id, summary);
      setSummaries((current) => (plainEqual(current, next) ? current : next));
    });
    return () => {
      cancelled = true;
    };
  }, [projects, threadIds, busyKey, now]);

  const views = useMemo(() => {
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const out = new Map<string, ThreadView[]>();
    const cache = viewCache.current;
    const seen = new Set<string>();
    for (const project of projects) {
      const threads = registry.get(project.id) ?? [];
      out.set(
        project.id,
        threads.flatMap((thread) => {
          const session = byId.get(thread.sessionId);
          const summary = summaries.get(thread.sessionId);
          // Never sent, or deleted since: nothing to show.
          if (!session && !summary) return [];
          seen.add(thread.sessionId);
          const known = lastKnown.current.get(thread.sessionId);
          const unseen = unseenFinishedIds.has(thread.sessionId);
          // Streamed events replace only the session that changed; every
          // other thread keeps its view without scanning its blocks again.
          const inputs = [thread, session, summary, unseen, now, known];
          const cached = cache.get(thread.sessionId);
          let view: ThreadView;
          if (
            cached &&
            cached.inputs.every((input, i) => Object.is(input, inputs[i]))
          )
            view = cached.view;
          else {
            view = threadView({
              thread,
              session,
              summary,
              unseen,
              now,
              steps: known?.steps,
            });
            // Idle threads unload; keep showing what they last said and did.
            if (session) {
              const nextKnown = {
                steps: view.steps,
                activity: view.status === "busy" ? undefined : view.activity,
              };
              if (!plainEqual(known, nextKnown)) {
                lastKnown.current.set(thread.sessionId, nextKnown);
                inputs[5] = nextKnown;
              }
            } else if (!view.activity && known?.activity)
              view = { ...view, activity: known.activity };
            cache.set(thread.sessionId, { inputs, view });
          }
          return [view];
        }),
      );
    }
    for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id);
    return out;
  }, [projects, registry, sessions, summaries, unseenFinishedIds, now]);

  // A solved thread that starts working again is open again. Only the start
  // counts, so marking a running thread solved sticks until its next turn.
  const wasBusy = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const busy = new Set(busyKey ? busyKey.split(",") : []);
    for (const [projectId, threads] of registry) {
      for (const thread of threads) {
        if (
          thread.resolvedAt &&
          busy.has(thread.sessionId) &&
          !wasBusy.current.has(thread.sessionId)
        )
          resolveProjectThread(projectId, thread.sessionId, false);
      }
    }
    wasBusy.current = busy;
  }, [registry, busyKey]);

  // Sessions change with every streamed event; the rail and the overview
  // only re-render when a thread's view actually changes.
  return useStableValue(views);
}
