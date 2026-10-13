import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  allProjectThreadIds,
  projectThreadsSnapshot,
  subscribeProjectThreads,
} from "../../features/coordinator/model/coordinator";
import {
  activityCount,
  activityLog,
  currentTurn,
  hasOwnTaskList,
  loadThreadPlan,
  parsePlan,
  planPrompt,
  saveThreadPlan,
  subscribeThreadPlans,
  threadPlansSnapshot,
} from "../../features/coordinator/model/threadPlan";
import type { Block, Session } from "../../features/sessions/model/session";
import { runClaudeTextPrompt } from "../../integrations/harness/providers/claude/claudeText";

/** A plan is brought up to date at most this often while a thread works. */
const UPDATE_EVERY_MS = 20_000;
/** How often busy threads are looked at for new activity. */
const CHECK_EVERY_MS = 8_000;
/** After a failed request, a thread is left alone this long. */
const BACKOFF_MS = 60_000;
const REQUEST_TIMEOUT_MS = 40_000;

/** The agent's last prose in the turn: its answer. */
function finalReply(work: readonly Block[]): string {
  for (let i = work.length - 1; i >= 0; i--) {
    const block = work[i];
    if (block.role === "assistant" && !block.tool && block.text.trim())
      return block.text;
  }
  return "";
}

/**
 * Keeps a checklist for every project thread whose agent keeps none of its
 * own: a small model writes it when a turn starts, updates it as the agent
 * works, and settles it when the turn ends.
 */
export function useThreadPlans(sessions: readonly Session[]): void {
  const threadsSnap = useSyncExternalStore(
    subscribeProjectThreads,
    projectThreadsSnapshot,
  );
  // The registry is read through its snapshot.
  const threadIds = useMemo(() => allProjectThreadIds(), [threadsSnap]);
  const inFlight = useRef(new Set<string>());
  const asked = useRef(
    new Map<string, { turnId: string; count: number; at: number }>(),
  );
  const backoff = useRef(new Map<string, number>());
  const [tick, setTick] = useState(0);
  // A saved plan can unblock a thread that finished while it was asked.
  const plans = useSyncExternalStore(subscribeThreadPlans, threadPlansSnapshot);
  const anyBusy = sessions.some(
    (session) => session.busy && threadIds.has(session.id),
  );

  useEffect(() => {
    if (!anyBusy) return;
    const timer = window.setInterval(
      () => setTick((n) => n + 1),
      CHECK_EVERY_MS,
    );
    return () => window.clearInterval(timer);
  }, [anyBusy]);

  useEffect(() => {
    const now = Date.now();
    for (const session of sessions) {
      const id = session.id;
      if (!threadIds.has(id) || inFlight.current.has(id)) continue;
      if ((backoff.current.get(id) ?? 0) > now) continue;
      const turn = currentTurn(session.blocks);
      if (!turn || !turn.user.text.trim() || hasOwnTaskList(turn.work))
        continue;
      const turnId = turn.user.id;
      const plan = loadThreadPlan(id);
      const current = plan?.turnId === turnId ? plan : undefined;
      const count = activityCount(turn.work);
      const last = asked.current.get(id);
      const lastForTurn = last?.turnId === turnId ? last : undefined;
      let final = false;
      if (session.busy) {
        // Started, or brought up to date when there is something new.
        if (
          lastForTurn &&
          (now - lastForTurn.at < UPDATE_EVERY_MS ||
            (current && lastForTurn.count === count))
        )
          continue;
      } else {
        // Only a plan made while the turn ran is settled; old turns stay.
        if (!current || current.final) continue;
        final = true;
      }
      inFlight.current.add(id);
      asked.current.set(id, { turnId, count, at: now });
      const prompt = planPrompt({
        task: turn.user.text,
        previous: current?.items,
        activity: activityLog(turn.work),
        ...(final ? { finalReply: finalReply(turn.work) } : {}),
      });
      void runClaudeTextPrompt({
        cwd: session.worktreeCwd ?? session.cwd,
        providerAccountId: session.providerAccountId,
        prompt,
        timeoutMs: REQUEST_TIMEOUT_MS,
      })
        .then((output) => {
          const items = parsePlan(output);
          if (!items) throw new Error("No usable checklist in the reply");
          // The agent may have started its own list meanwhile; it wins anyway.
          saveThreadPlan(id, {
            turnId,
            items: final
              ? items.map((item) =>
                  item.status === "in_progress"
                    ? { ...item, status: "completed" as const }
                    : item,
                )
              : items,
            updatedAt: Date.now(),
            ...(final ? { final: true } : {}),
          });
        })
        .catch((error: unknown) => {
          console.debug("[monocode] thread checklist", error);
          backoff.current.set(id, Date.now() + BACKOFF_MS);
        })
        .finally(() => {
          inFlight.current.delete(id);
        });
    }
  }, [sessions, threadIds, tick, plans]);
}
