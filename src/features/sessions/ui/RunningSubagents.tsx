import { useEffect, useState, type ReactNode } from "react";
import type { BackgroundTask, Block } from "../model/session";
import { formatLiveElapsed } from "../model/liveAgents";
import {
  isSubagentBlock,
  isSupersededSyntheticSubagent,
  subagentBrief,
  subagentBriefFrom,
  subagentModelName,
  subagentName,
  toolCallState,
} from "../model/transcriptActivity";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { MessageSquare, Square } from "../../../shared/ui/icons";

type Props = {
  /** The runs listed under Main: the live ones, plus the one being viewed. */
  runs: Block[];
  /** Runs of the live turn still working; anything else reads as settled. */
  liveIds: ReadonlySet<string>;
  /** The run swapped in for the session's transcript; null shows Main. */
  viewedId: string | null;
  /** Swaps the pane to a run's transcript, or back to Main with null. */
  onView: (blockId: string | null) => void;
  /** Stops a run that works as a background task, keyed by its block id. */
  onStop?: (blockId: string) => void;
  /** Runs whose background task can be stopped from their line. */
  stoppable?: ReadonlySet<string>;
};

/**
 * The session and the delegated runs it is waiting on, one line each, docked
 * above the composer. Main is the session's own transcript; a run swaps the
 * pane over to what that agent is doing, and Main swaps it back.
 */
export function RunningSubagents({
  runs,
  liveIds,
  viewedId,
  onView,
  onStop,
  stoppable,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const live = runs.filter((block) => liveIds.has(block.id)).length;
  const ticking = live > 0;

  // A stop that never lands gives the button back rather than spinning on.
  useEffect(() => {
    if (stopping.size === 0) return;
    const id = window.setTimeout(() => setStopping(new Set()), 8000);
    return () => window.clearTimeout(id);
  }, [stopping]);

  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  return (
    <div
      role="group"
      aria-label="Session and subagents"
      data-running-subagents
      className={`-mx-1 ${runs.length > 4 ? "max-h-40 overflow-y-auto overflow-x-hidden" : ""}`}
    >
      <Row
        selected={viewedId === null}
        title="Show the main session"
        onClick={() => onView(null)}
        icon={<MessageSquare className="size-3.5 shrink-0" />}
        label="Main"
        detail={
          live
            ? `${live} ${live === 1 ? "subagent" : "subagents"} running`
            : undefined
        }
      />
      {runs.map((block) => {
        const name = subagentName(block);
        const model = subagentModelName(block);
        const state = toolCallState(block);
        const running = liveIds.has(block.id);
        const elapsed =
          running && block.startedAt != null
            ? formatLiveElapsed(block.startedAt, now)
            : "";
        const status = running
          ? elapsed
          : state === "rejected"
            ? "failed"
            : state === "pending"
              ? "stopped"
              : "done";
        return (
          <Row
            key={block.id}
            runId={block.id}
            selected={viewedId === block.id}
            title={[subagentBrief(block), model].filter(Boolean).join("\n")}
            onClick={() => onView(block.id)}
            icon={
              <ProjectMascot
                project={name}
                active={running}
                className={`size-3.5 shrink-0 ${
                  state === "rejected" ? "text-red-400" : "text-content/70"
                }`}
              />
            }
            label={name}
            model={model}
            detail={status}
            state={running ? "running" : status}
            stop={
              running && onStop && stoppable?.has(block.id)
                ? {
                    busy: stopping.has(block.id),
                    onClick: () => {
                      setStopping((prev) => new Set(prev).add(block.id));
                      onStop(block.id);
                    },
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

function Row({
  runId,
  selected,
  title,
  onClick,
  icon,
  label,
  model,
  detail,
  state,
  stop,
}: {
  runId?: string;
  selected: boolean;
  title: string;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  model?: string;
  detail?: string;
  /** Spoken in place of the ticking elapsed time. */
  state?: string;
  stop?: { busy: boolean; onClick: () => void };
}) {
  return (
    <div
      data-running-subagent={runId}
      className={`flex min-h-7 w-full min-w-0 items-center gap-1 rounded-md px-1 transition-colors duration-150 hover:bg-content/8 ${
        selected ? "bg-content/8" : ""
      }`}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={[label, model, state].filter(Boolean).join(", ")}
        title={title}
        onClick={onClick}
        className="flex min-h-7 min-w-0 flex-1 items-center gap-2 text-left text-[12px] hover:text-content"
      >
        {icon}
        <span
          className={`min-w-0 flex-1 truncate ${
            selected ? "text-content" : "text-content/80"
          }`}
        >
          {label}
        </span>
        {model ? (
          <span className="max-w-[40%] shrink truncate text-content/40">
            {model}
          </span>
        ) : null}
        {detail ? (
          <span className="shrink-0 tabular-nums text-content/40">
            {detail}
          </span>
        ) : null}
      </button>
      {stop ? (
        <button
          type="button"
          title={`Stop ${label}`}
          aria-label={`Stop ${label}`}
          disabled={stop.busy}
          onClick={stop.onClick}
          className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] hover:bg-content/10 hover:text-content disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <Square className="size-2.5 fill-current" strokeWidth={0} />
          {stop.busy ? "Stopping…" : "Stop"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Runs spawned by the live turn that have not reported back. A stopped turn
 * leaves its runs' last status behind, so a run from an earlier turn can still
 * read as in progress; only the run since the last prompt is live. A message
 * steered into that run joins it, so its runs stay counted.
 */
export function runningSubagents(blocks: Block[]): Block[] {
  const turn: Block[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user" && !block.internal && !block.steered) break;
    turn.unshift(block);
  }
  return turn.filter(
    (block) =>
      isSubagentBlock(block) &&
      toolCallState(block) === "pending" &&
      !isSupersededSyntheticSubagent(block, turn),
  );
}

/**
 * Each run's own background task id, keyed by the run's block id. The task
 * names the tool call that spawned it when the harness knows; otherwise fall
 * back to the description both carry, which may still hold the "Task" prefix
 * the run's name drops.
 */
export function subagentBackgroundTasks(
  tasks: BackgroundTask[],
  runs: Block[],
): Map<string, string> {
  const matched = new Map<string, string>();
  const agents = tasks.filter((task) => task.agent);
  const unclaimed = (block: Block) => !matched.has(block.id);
  const rest: BackgroundTask[] = [];
  for (const task of agents) {
    const run = task.callId
      ? runs.find(
          (block) => unclaimed(block) && block.tool?.callId === task.callId,
        )
      : undefined;
    if (run) matched.set(run.id, task.id);
    else rest.push(task);
  }
  // A finished run left open in the view must not claim a live run's task.
  const settled = (block: Block) => toolCallState(block) !== "pending";
  const byLiveness = [...runs].sort(
    (a, b) => Number(settled(a)) - Number(settled(b)),
  );
  for (const { id, description } of rest) {
    const run = byLiveness.find(
      (block) =>
        unclaimed(block) &&
        (description === block.tool?.title ||
          description === subagentName(block) ||
          subagentBriefFrom(description) === subagentBrief(block)),
    );
    if (run) matched.set(run.id, id);
  }
  return matched;
}
