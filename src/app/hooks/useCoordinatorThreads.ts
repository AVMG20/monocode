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
import {
  subscribeThreadPlans,
  threadPlansSnapshot,
} from "../../features/coordinator/model/threadPlan";
import { listCoordinatorProjects } from "../../features/monos/model/mono";
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
  const busyKey = sessions
    .filter((session) => session.busy)
    .map((session) => session.id)
    .sort()
    .join(",");
  const [summaries, setSummaries] = useState<
    ReadonlyMap<string, SessionSummary>
  >(() => new Map());
  const [tick, setTick] = useState(0);
  const plans = useSyncExternalStore(subscribeThreadPlans, threadPlansSnapshot);
  const lastKnown = useRef(
    new Map<string, { steps?: ThreadSteps; activity?: string }>(),
  );

  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const folders = new Set(
      projects.flatMap((project) => project.projects.slice(0, 1)),
    );
    const wanted = new Set(
      [...registry.values()].flat().map((thread) => thread.sessionId),
    );
    if (!wanted.size) {
      setSummaries(new Map());
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
        if (wanted.has(summary.id)) next.set(summary.id, summary);
      setSummaries(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projects, registry, busyKey, tick]);

  const views = useMemo(() => {
    const now = Date.now();
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const out = new Map<string, ThreadView[]>();
    for (const project of projects) {
      const threads = registry.get(project.id) ?? [];
      out.set(
        project.id,
        threads.flatMap((thread) => {
          const session = byId.get(thread.sessionId);
          const summary = summaries.get(thread.sessionId);
          // Never sent, or deleted since: nothing to show.
          if (!session && !summary) return [];
          const known = lastKnown.current.get(thread.sessionId);
          const view = threadView({
            thread,
            session,
            summary,
            unseen: unseenFinishedIds.has(thread.sessionId),
            now,
            steps: known?.steps,
            plan: plans[thread.sessionId],
          });
          // Idle threads unload; keep showing what they last said and did.
          if (session)
            lastKnown.current.set(thread.sessionId, {
              steps: view.steps,
              activity: view.status === "busy" ? undefined : view.activity,
            });
          else if (!view.activity && known?.activity)
            return [{ ...view, activity: known.activity }];
          return [view];
        }),
      );
    }
    return out;
    // `tick` re-evaluates the time-based statuses.
  }, [projects, registry, sessions, summaries, unseenFinishedIds, tick, plans]);

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

  return views;
}
