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
  activityLog,
  currentTurn,
  hasOwnTaskList,
  loadThreadPlan,
  parsePlan,
  PLAN_SYSTEM,
  planPrompt,
  proseCount,
  saveThreadPlan,
  subscribeThreadPlans,
  threadPlansSnapshot,
} from "../../features/coordinator/model/threadPlan";
import type { Block, Session } from "../../features/sessions/model/session";
import { runClaudeOneShot } from "../../integrations/harness/providers/claude/claudeOneShot";

/** A plan is brought up to date at most this often while a thread works. */
const UPDATE_EVERY_MS = 45_000;
/** Finished commands that make a step boundary on their own. */
const MIN_NEW_STEPS = 3;
/** Updates per turn while it runs; the final pass comes on top. */
const MAX_UPDATES = 10;
/** How often busy threads are looked at for new activity. */
const CHECK_EVERY_MS = 15_000;
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
    new Map<
      string,
      {
        turnId: string;
        /** Activity lines already sent. */
        lines: number;
        /** Agent messages already seen. */
        prose: number;
        at: number;
        updates: number;
      }
    >(),
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
      const lines = activityLog(turn.work);
      const prose = proseCount(turn.work);
      const last = asked.current.get(id);
      const sent = last?.turnId === turnId ? last : undefined;
      let final = false;
      if (session.busy) {
        if (sent) {
          // Brought up to date at real step boundaries only: a few finished
          // commands or a message from the agent, not more than every so
          // often, and only so many times a turn.
          const boundary =
            lines.length - sent.lines >= MIN_NEW_STEPS || prose > sent.prose;
          if (
            sent.updates >= MAX_UPDATES ||
            now - sent.at < UPDATE_EVERY_MS ||
            (current && !boundary)
          )
            continue;
        }
      } else {
        // Only a plan made while the turn ran is settled; old turns stay.
        if (!current || current.final) continue;
        final = true;
      }
      inFlight.current.add(id);
      asked.current.set(id, {
        turnId,
        lines: lines.length,
        prose,
        at: now,
        updates: (sent?.updates ?? 0) + 1,
      });
      // The checklist carries what came before; send only what is new.
      const prompt = planPrompt({
        task: turn.user.text,
        previous: current?.items,
        activity: current ? lines.slice(sent?.lines ?? 0) : lines,
        ...(final ? { finalReply: finalReply(turn.work) } : {}),
      });
      void runClaudeOneShot({
        prompt,
        system: PLAN_SYSTEM,
        providerAccountId: session.providerAccountId,
        fallbackCwd: session.worktreeCwd ?? session.cwd,
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
          // What failed to send is sent again with the next request.
          const entry = asked.current.get(id);
          if (entry?.turnId === turnId)
            asked.current.set(id, {
              ...entry,
              lines: sent?.lines ?? 0,
              prose: sent?.prose ?? 0,
            });
        })
        .finally(() => {
          inFlight.current.delete(id);
        });
    }
  }, [sessions, threadIds, tick, plans]);
}
