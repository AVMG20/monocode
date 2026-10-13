import type { CSSProperties, ReactNode } from "react";
import { IconButton } from "../../../app/shell/TitleBar";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import {
  CheckCircle,
  ChevronRight,
  Maximize2,
  X,
} from "../../../shared/ui/icons";
import { TerminalSpinner } from "../../sessions/ui/TerminalSpinner";
import {
  THREAD_STATUS_LABEL,
  type ThreadStatus,
  type ThreadSteps,
} from "../model/coordinator";
import { ThreadStepsBar } from "./ThreadStepsBar";
import {
  PROJECT_PANEL_MIN,
  projectPanelDefault,
  projectPanelMax,
  projectPanelWidth,
  rememberProjectPanelWidth,
} from "./projectPanelWidth";

const STATUS_PILL: Record<ThreadStatus, string> = {
  waiting: "border-amber-400/30 bg-amber-400/10 text-amber-400",
  busy: "border-accent/30 bg-accent/10 text-accent",
  inactive: "border-stroke bg-content/5 text-content/50",
  solved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-400",
};

/** The thread open in the panel, in place of the list. */
export type OpenThread = {
  title: string;
  status: ThreadStatus;
  steps?: ThreadSteps;
  onBack: () => void;
  onResolve: (resolved: boolean) => void;
  onOpenInWorkspace: () => void;
};

/**
 * The panel beside the coordinator's chat: the project's threads, or one of
 * them, with a breadcrumb back to the list. Both keep one width, so opening
 * a thread or going back never resizes it.
 */
export function ThreadPanel({
  color,
  count,
  thread,
  onClose,
  windowControls,
  children,
}: {
  color: string;
  count?: number;
  thread?: OpenThread;
  onClose: () => void;
  windowControls?: ReactNode;
  children: ReactNode;
}) {
  const resize = useDragResize({
    min: PROJECT_PANEL_MIN,
    max: projectPanelMax,
    defaultWidth: projectPanelDefault(),
    initial: projectPanelWidth(),
    direction: "left",
    onCommit: rememberProjectPanelWidth,
  });
  const status = thread?.status;
  const solved = status === "solved";
  const resolveLabel = solved ? "Reopen thread" : "Mark solved";
  return (
    <aside
      ref={resize.setPaneRef}
      aria-label={thread ? `Thread: ${thread.title}` : "Threads"}
      data-thread-panel={thread ? "thread" : "list"}
      style={
        {
          "--mono-color": color,
          "--mono-window-controls-width": windowControls
            ? "calc(7.5rem + 1px)"
            : "0px",
        } as CSSProperties
      }
      className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-stroke font-sans"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize threads panel"
        className={`absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none ${resize.dragging ? "bg-content/15" : "hover:bg-content/10"}`}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
      />
      {windowControls ? (
        <div className="absolute right-0 top-0 z-30 h-10">{windowControls}</div>
      ) : null}
      <header
        className="flex h-10 shrink-0 items-center gap-2 border-b border-stroke pl-4"
        style={{ paddingRight: "var(--mono-window-controls-width)" }}
        data-tauri-drag-region="deep"
      >
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 flex-1 items-center gap-1 text-[13px]"
        >
          {thread ? (
            <>
              <button
                type="button"
                title="Back to threads"
                data-tauri-drag-region="false"
                onClick={thread.onBack}
                className="shrink-0 rounded px-1 -mx-1 text-content/50 outline-none hover:bg-content/8 hover:text-content focus-visible:ring-1 focus-visible:ring-accent/50"
              >
                Threads
              </button>
              <ChevronRight
                aria-hidden
                className="size-3 shrink-0 text-content/35"
              />
              <h3
                className="min-w-0 truncate font-medium text-content"
                title={thread.title}
              >
                {thread.title}
              </h3>
            </>
          ) : (
            <h3 className="flex min-w-0 items-baseline gap-1.5 font-medium text-content">
              Threads
              {count ? (
                <span className="text-[11px] font-normal tabular-nums text-content/40">
                  {count}
                </span>
              ) : null}
            </h3>
          )}
        </nav>
        {thread && status ? (
          <span
            data-thread-status={status}
            className={`flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium ${STATUS_PILL[status]}`}
          >
            {status === "busy" ? (
              <TerminalSpinner className="inline-block w-2.5 select-none text-center text-[10px] leading-none" />
            ) : null}
            {THREAD_STATUS_LABEL[status]}
          </span>
        ) : null}
        <div className="flex shrink-0 items-center gap-0.5 px-3">
          {thread ? (
            <>
              <button
                type="button"
                title={resolveLabel}
                aria-label={resolveLabel}
                aria-pressed={solved}
                data-tauri-drag-region="false"
                onClick={() => thread.onResolve(!solved)}
                className={`grid size-6.5 place-items-center rounded-md outline-none hover:bg-content/10 focus-visible:ring-1 focus-visible:ring-accent/50 ${
                  solved
                    ? "text-emerald-400"
                    : "text-content/50 hover:text-content"
                }`}
              >
                <CheckCircle className="size-3.5" />
              </button>
              <IconButton
                label="Open in workspace"
                onClick={thread.onOpenInWorkspace}
              >
                <Maximize2 className="size-3.5" />
              </IconButton>
            </>
          ) : null}
          <IconButton label="Close threads" onClick={onClose}>
            <X className="size-3.5" />
          </IconButton>
        </div>
      </header>
      {thread?.steps ? (
        <ThreadStepsBar steps={thread.steps} busy={status === "busy"} />
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}
