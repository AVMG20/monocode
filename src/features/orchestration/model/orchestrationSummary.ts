import type { HarnessId } from "../../sessions/model/session";

type TaskStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "blocked"
  | "interrupted"
  | "cancelled";

/**
 * Saved history projection of an orchestration run from the old chat
 * runtime. Kept so legacy sessions still list their workers' outcomes.
 */
export type OrchestrationSummary = {
  status: "active" | "paused" | "stopped" | "finished";
  live?: boolean;
  tasks: {
    sessionId: string;
    title: string;
    harness: HarnessId;
    model: string;
    status: TaskStatus;
    needsInput?: boolean;
  }[];
};

export function orchestrationTaskLabel(
  task: OrchestrationSummary["tasks"][number],
  summary: OrchestrationSummary,
): string {
  if (task.needsInput) return "Needs input";
  if (
    !summary.live &&
    ["running", "cancelling", "queued"].includes(task.status)
  )
    return "Saved";
  if (summary.status === "paused" && task.status === "queued") return "Paused";
  return {
    queued: "Queued",
    running: "Working",
    cancelling: "Stopping",
    completed: "Done",
    failed: "Failed",
    blocked: "Needs review",
    interrupted: "Interrupted",
    cancelled: "Cancelled",
  }[task.status];
}
