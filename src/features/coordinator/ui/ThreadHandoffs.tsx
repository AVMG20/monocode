import { CheckCircle } from "../../../shared/ui/icons";
import { TerminalSpinner } from "../../sessions/ui/TerminalSpinner";
import {
  THREAD_STATUS_LABEL,
  type ThreadHandoff,
  type ThreadStatus,
  type ThreadView,
} from "../model/coordinator";

const STATUS_DOT: Record<ThreadStatus, string> = {
  waiting: "bg-amber-400",
  busy: "bg-accent",
  inactive: "bg-content/30",
  solved: "bg-emerald-400",
};

/**
 * The work the coordinator handed out in one turn, under its reply: each
 * thread it started or messaged, or whose report it answered, and where that
 * thread stands now. What it told the thread shows in the thread itself.
 */
export function ThreadHandoffs({
  handoffs,
  threads,
  onOpenThread,
}: {
  handoffs: readonly ThreadHandoff[];
  threads: readonly ThreadView[];
  onOpenThread?: (sessionId: string) => void;
}) {
  // A call the coordinator got wrong and then retried is its own business;
  // only a failure nothing made up for is worth showing.
  // A report needs no card of its own when the turn messaged that thread.
  const shown = handoffs.filter(
    (handoff, index) =>
      (!handoff.failed ||
        !handoffs
          .slice(index + 1)
          .some((later) => later.kind === handoff.kind && !later.failed)) &&
      (handoff.kind !== "report" ||
        !handoffs.some(
          (other) =>
            other.kind !== "report" && other.sessionId === handoff.sessionId,
        )),
  );
  if (!shown.length) return null;
  return (
    <div
      data-thread-handoffs=""
      className="flex flex-col gap-1.5 px-4 pb-3 pt-1 font-sans"
    >
      {shown.map((handoff, index) => (
        <HandoffCard
          key={`${handoff.sessionId ?? "pending"}:${index}`}
          handoff={handoff}
          view={
            handoff.sessionId
              ? threads.find((view) => view.sessionId === handoff.sessionId)
              : undefined
          }
          onOpenThread={onOpenThread}
        />
      ))}
    </div>
  );
}

function HandoffCard({
  handoff,
  view,
  onOpenThread,
}: {
  handoff: ThreadHandoff;
  view?: ThreadView;
  onOpenThread?: (sessionId: string) => void;
}) {
  const sessionId = handoff.sessionId;
  const canOpen = !!sessionId && !!view && !!onOpenThread;
  const verb =
    handoff.kind === "report"
      ? handoff.outcome === "failed"
        ? "Stopped with an error"
        : handoff.outcome === "cancelled"
          ? "Stopped before finishing"
          : "Reported back"
      : handoff.pending
        ? handoff.kind === "start"
          ? "Starting a thread…"
          : "Forwarding…"
        : handoff.failed
          ? handoff.kind === "start"
            ? "Could not start the thread"
            : "Could not forward the message"
          : handoff.kind === "start"
            ? "Started thread"
            : handoff.queued
              ? "Queued for when the thread is free"
              : "Forwarded to thread";
  const title = view?.title ?? (handoff.pending ? "New thread" : "Thread");
  const steps = view?.steps;
  return (
    <article
      data-thread-handoff={handoff.kind}
      className={`max-w-xl overflow-hidden rounded-xl border bg-content/[0.025] ${
        handoff.failed ? "border-red-400/25" : "border-stroke"
      }`}
    >
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => sessionId && onOpenThread?.(sessionId)}
        title={canOpen ? `Open ${title}` : undefined}
        className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left outline-none enabled:hover:bg-content/[0.04] focus-visible:bg-content/[0.05] disabled:cursor-default"
      >
        <span className="grid size-5 shrink-0 place-items-center">
          <ThreadStatusIcon
            status={handoff.pending ? "busy" : view?.status}
            failed={handoff.failed}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate text-[13px] font-medium text-content">
              {title}
            </span>
            {view ? (
              <span className="shrink-0 text-[11px] text-content/40">
                {THREAD_STATUS_LABEL[view.status]}
              </span>
            ) : null}
          </span>
          <span className="min-w-0 truncate text-[11.5px] text-content/45">
            {view?.activity && view.status !== "solved" ? view.activity : verb}
          </span>
        </span>
        {steps ? (
          <span
            title={`${steps.done} of ${steps.total} steps done`}
            className="shrink-0 rounded-full border border-stroke px-1.5 py-px font-mono text-[10px] tabular-nums text-content/50"
          >
            {steps.done}/{steps.total}
          </span>
        ) : null}
      </button>
    </article>
  );
}

/** Where a thread stands, as one small mark: spinning, solved or a dot. */
export function ThreadStatusIcon({
  status,
  failed,
}: {
  status?: ThreadStatus;
  failed?: boolean;
}) {
  if (status === "busy")
    return (
      <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none text-accent" />
    );
  if (status === "solved")
    return <CheckCircle className="size-3.5 text-emerald-400" />;
  return (
    <span
      aria-hidden
      className={`size-2 rounded-full ${
        failed ? "bg-red-400" : status ? STATUS_DOT[status] : "bg-content/30"
      }`}
    />
  );
}
