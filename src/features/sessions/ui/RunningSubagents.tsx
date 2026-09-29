import { useEffect, useMemo, useState } from "react";
import type { Block } from "../model/session";
import { formatLiveElapsed } from "../model/liveAgents";
import {
  isSubagentBlock,
  isSupersededSyntheticSubagent,
  subagentBrief,
  subagentModelName,
  subagentName,
  toolCallState,
} from "../model/transcriptActivity";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";

type Props = {
  blocks: Block[];
  /** Scrolls the transcript to the run's row. */
  onSelect?: (blockId: string) => void;
};

/**
 * The delegated runs still going, one pill each, docked above the composer.
 * Their rows sit where they were spawned, which is often far up the
 * transcript by the time you wonder how many are left and how long they took.
 */
export function RunningSubagents({ blocks, onSelect }: Props) {
  const running = useMemo(() => runningSubagents(blocks), [blocks]);
  const [now, setNow] = useState(() => Date.now());
  const ticking = running.length > 0;

  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  if (!ticking) return null;

  return (
    <div
      aria-label="Running subagents"
      data-running-subagents
      className="flex flex-wrap items-center gap-1 px-2 pb-1.5"
    >
      {running.map((block) => {
        const name = subagentName(block);
        const model = subagentModelName(block);
        const elapsed =
          block.startedAt != null ? formatLiveElapsed(block.startedAt, now) : "";
        const title = [subagentBrief(block), model, elapsed]
          .filter(Boolean)
          .join("\n");
        return (
          <button
            key={block.id}
            type="button"
            title={title}
            aria-label={[name, model, elapsed].filter(Boolean).join(", ")}
            data-running-subagent={block.id}
            onClick={() => onSelect?.(block.id)}
            className="flex h-6 min-w-0 max-w-72 items-center gap-1.5 rounded-full border border-content/10 bg-content/5 pr-2 pl-1.5 font-sans text-[11px] text-content/70 backdrop-blur-sm transition-colors duration-150 hover:bg-content/10 hover:text-content"
          >
            <ProjectMascot
              project={name}
              active
              className="size-3 shrink-0 text-content/70"
            />
            <span className="min-w-0 truncate">{name}</span>
            {elapsed ? (
              <span className="shrink-0 tabular-nums text-content/40">
                {elapsed}
              </span>
            ) : null}
          </button>
        );
      })}
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
