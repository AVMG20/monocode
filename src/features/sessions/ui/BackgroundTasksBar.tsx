import { useEffect, useState, type ReactNode } from "react";
import type { BackgroundTask } from "../model/session";
import {
  ChevronDown,
  ChevronUp,
  Square,
  Terminal,
} from "../../../shared/ui/icons";

type Props = {
  tasks: BackgroundTask[];
  /** Stops one task; absent when the harness cannot stop a single one. */
  onStopTask?: (taskId: string) => void;
  /** Stops everything left running, and the turn waiting on it. */
  onStopAll?: () => void;
  /** Main and the subagents it is waiting on, listed above the tasks. */
  subagents?: ReactNode;
};

/**
 * What the agent left running after it yielded: dev servers, watchers,
 * monitors. Docked on the composer rather than folded into the last reply,
 * since that reply is finished and the work outlives it, and each one can be
 * stopped from here. Running subagents share the dock, always on top and
 * divided from the commands.
 */
export function BackgroundTasksBar({
  tasks,
  onStopTask,
  onStopAll,
  subagents,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [stoppingAll, setStoppingAll] = useState(false);

  // Forget stop requests for tasks that have ended.
  const key = tasks.map((task) => task.id).join("\n");
  useEffect(() => {
    setStopping((prev) => {
      const ids = new Set(key.split("\n"));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    if (!key) setStoppingAll(false);
  }, [key]);

  if (tasks.length === 0 && !subagents) return null;

  const multiple = tasks.length > 1;
  const showRows = !multiple || expanded;
  const stopTask = onStopTask
    ? (taskId: string) => {
        setStopping((prev) => new Set(prev).add(taskId));
        onStopTask(taskId);
      }
    : undefined;
  const stopAll = onStopAll
    ? () => {
        setStoppingAll(true);
        onStopAll();
      }
    : undefined;

  return (
    <div className="px-2 text-content/55" data-background-tasks>
      <div
        data-background-tasks-card
        className="relative z-0 rounded-t-[10px] border border-b-0 border-content/10 bg-content/3 px-2 py-1"
      >
        {subagents}
        {subagents && tasks.length > 0 ? (
          <div role="separator" className="my-1 border-t border-stroke" />
        ) : null}
        {multiple ? (
          <div
            className={`flex h-7 items-center gap-2 text-[12px] ${
              expanded ? "border-b border-stroke" : ""
            }`}
          >
            <LiveDot />
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-content"
            >
              <span className="min-w-0 truncate text-content/80">
                {tasks.length} tasks running in background
              </span>
              {expanded ? (
                <ChevronUp className="size-3.5 shrink-0" />
              ) : (
                <ChevronDown className="size-3.5 shrink-0" />
              )}
            </button>
            {stopAll ? (
              <StopButton
                label="Stop all"
                title={
                  subagents
                    ? "Stop the turn, its subagents, and all background tasks"
                    : "Stop all background tasks"
                }
                busy={stoppingAll}
                onClick={stopAll}
              />
            ) : null}
          </div>
        ) : null}
        {showRows && tasks.length > 0 ? (
          <div className={multiple ? "max-h-32 overflow-y-auto" : undefined}>
            {tasks.map((task, index) => (
              <div
                key={task.id}
                data-background-task={task.id}
                title={task.description}
                className={`flex min-h-7 items-center gap-2 text-[12px] ${
                  index > 0 ? "border-t border-stroke" : ""
                }`}
              >
                {multiple ? (
                  <Terminal className="size-3.5 shrink-0" />
                ) : (
                  <LiveDot />
                )}
                <span className="min-w-0 flex-1 truncate text-content/80">
                  {task.description || "Background task"}
                </span>
                {!multiple ? (
                  <span className="shrink-0 text-content/40">
                    Running in background
                  </span>
                ) : null}
                {stopTask || (!multiple && stopAll) ? (
                  <StopButton
                    label="Stop"
                    title={`Stop ${task.description || "background task"}`}
                    busy={stopping.has(task.id) || stoppingAll}
                    onClick={() => (stopTask ? stopTask(task.id) : stopAll?.())}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative grid size-3.5 shrink-0 place-items-center">
      <span className="absolute size-2 animate-ping rounded-full bg-emerald-400/40 motion-reduce:animate-none" />
      <span className="relative size-1.5 rounded-full bg-emerald-400" />
    </span>
  );
}

function StopButton({
  label,
  title,
  busy,
  onClick,
}: {
  label: string;
  title: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={onClick}
      className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <Square className="size-2.5 fill-current" strokeWidth={0} />
      {busy ? "Stopping…" : label}
    </button>
  );
}
