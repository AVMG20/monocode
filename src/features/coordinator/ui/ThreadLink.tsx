import type { ReactNode } from "react";
import { CheckCircle } from "../../../shared/ui/icons";
import { TerminalSpinner } from "../../sessions/ui/TerminalSpinner";
import type { ThreadStatus, ThreadView } from "../model/coordinator";

const THREAD_HREF = /^#thread-(.+)$/;

/** The thread a coordinator's `[title](#thread-<id>)` link points at. */
export function threadLinkId(href: string): string | undefined {
  return THREAD_HREF.exec(href)?.[1];
}

/**
 * A thread the coordinator names in its reply: its title and live status,
 * opening the thread on click. A thread that is gone reads as plain text.
 */
export function ThreadLink({
  view,
  children,
  onOpenThread,
}: {
  view?: ThreadView;
  children: ReactNode;
  onOpenThread?: (sessionId: string) => void;
}) {
  if (!view || !onOpenThread) return <>{children}</>;
  return (
    <button
      type="button"
      data-thread-link={view.sessionId}
      title={`Open ${view.title}`}
      onClick={() => onOpenThread(view.sessionId)}
      className="mx-px inline-flex max-w-full items-baseline gap-1.5 rounded-md bg-content/[0.06] px-1.5 align-baseline font-sans text-sky-400/90 outline-none hover:bg-content/[0.1] hover:text-sky-300 focus-visible:bg-content/[0.12]"
    >
      <span className="grid size-3.5 shrink-0 translate-y-[0.15em] place-items-center self-start">
        <ThreadStatusIcon status={view.status} />
      </span>
      <span className="min-w-0 truncate">{view.title}</span>
    </button>
  );
}

const STATUS_DOT: Record<ThreadStatus, string> = {
  waiting: "bg-amber-400",
  busy: "bg-accent",
  inactive: "bg-content/30",
  solved: "bg-emerald-400",
};

/** Where a thread stands, as one small mark: spinning, solved or a dot. */
function ThreadStatusIcon({
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
