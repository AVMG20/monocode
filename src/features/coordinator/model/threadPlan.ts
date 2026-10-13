import type {
  Block,
  TaskListItem,
  TaskListItemStatus,
} from "../../sessions/model/session";

/**
 * A thread's checklist when the agent keeps none of its own: a small model
 * reads the task and what the agent has done so far, and writes the steps
 * the way a person would tick them off. The agent's own task list, when it
 * writes one, always wins (see `threadView`).
 */
export type ThreadPlan = {
  /** The user turn the plan is for. */
  turnId: string;
  items: TaskListItem[];
  updatedAt: number;
  /** Written after the turn ended, so it no longer changes. */
  final?: boolean;
};

const PLANS_KEY = "monocode:thread-plans";
const PLANS_CHANGED = "monocode:thread-plans-changed";
const MAX_PLANS = 200;

let cache: Record<string, ThreadPlan> | undefined;

function readPlans(): Record<string, ThreadPlan> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(PLANS_KEY) ?? "{}");
    cache =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, ThreadPlan>)
        : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function loadThreadPlan(sessionId: string): ThreadPlan | undefined {
  return readPlans()[sessionId];
}

export function saveThreadPlan(sessionId: string, plan: ThreadPlan): void {
  const plans = { ...readPlans(), [sessionId]: plan };
  // Keep the most recently updated plans; old threads keep their history.
  const kept = Object.entries(plans)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PLANS);
  cache = Object.fromEntries(kept);
  try {
    localStorage.setItem(PLANS_KEY, JSON.stringify(cache));
  } catch {
    // The plan still shows for this run.
  }
  window.dispatchEvent(new CustomEvent(PLANS_CHANGED));
}

export function subscribeThreadPlans(onChange: () => void): () => void {
  window.addEventListener(PLANS_CHANGED, onChange);
  return () => window.removeEventListener(PLANS_CHANGED, onChange);
}

/** Snapshot for `useSyncExternalStore`: changes whenever a plan is saved. */
export function threadPlansSnapshot(): Record<string, ThreadPlan> {
  return readPlans();
}

/** The turn a thread is on: its last message from the user or coordinator. */
export function currentTurn(
  blocks: readonly Block[],
): { user: Block; work: Block[] } | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user" && !block.internal && !block.draft)
      return { user: block, work: blocks.slice(i + 1) };
  }
  return undefined;
}

/** Whether the agent wrote a task list of its own in this turn. */
export function hasOwnTaskList(work: readonly Block[]): boolean {
  return work.some(
    (block) => block.role === "tasks" && !!block.taskList?.items.length,
  );
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** What the agent did in a turn, one line per step, oldest first. */
export function activityLog(work: readonly Block[]): string[] {
  const lines: string[] = [];
  for (const block of work) {
    if (block.role === "tool" && block.tool?.title) {
      const status =
        block.tool.status === "failed" || block.tool.status === "error"
          ? " (failed)"
          : "";
      lines.push(`- ran: ${clip(block.tool.title, 160)}${status}`);
    } else if (block.role === "assistant" && !block.tool && block.text.trim()) {
      lines.push(`- said: ${clip(block.text, 240)}`);
    }
  }
  return lines;
}

/** How often the agent wrote to the user in a turn: a natural step boundary. */
export function proseCount(work: readonly Block[]): number {
  return work.filter(
    (block) =>
      block.role === "assistant" &&
      !block.tool &&
      !block.streaming &&
      !!block.text.trim(),
  ).length;
}

/** The small model's whole system prompt; the request carries the rest. */
export const PLAN_SYSTEM =
  "You keep a short progress checklist for a coding agent. You only ever reply with the JSON object you are asked for.";

/** Most activity lines one request carries. */
const MAX_ACTIVITY_LINES = 30;

/** How much the agent has done, to tell whether a plan is out of date. */
export function activityCount(work: readonly Block[]): number {
  return work.filter(
    (block) =>
      block.role === "tool" ||
      (block.role === "assistant" && !block.tool && !block.streaming),
  ).length;
}

/** The request the small model answers with the checklist. */
export function planPrompt(input: {
  task: string;
  previous?: readonly TaskListItem[];
  /** Activity since the checklist was last updated, oldest first. */
  activity: readonly string[];
  /** The agent's final reply, once the turn has ended. */
  finalReply?: string;
}): string {
  const previous = input.previous?.length
    ? JSON.stringify(
        input.previous.map(({ text, status }) => ({ text, status })),
      )
    : "(none yet)";
  return [
    "Keep the progress checklist for this coding agent, like the todo list a person glances at to see how far along the work is.",
    `The task the agent was given:\n<task>\n${clip(input.task, 3_000)}\n</task>`,
    `The current checklist. Keep its wording stable; change, add or drop steps only when the work clearly went another way:\n<checklist>${previous}</checklist>`,
    `${input.previous?.length ? "What the agent has done since the checklist was last updated" : "What the agent has done so far"}, oldest first:\n<activity>\n${activityText(input.activity)}\n</activity>`,
    input.finalReply !== undefined
      ? `The agent has finished. Its final reply:\n<reply>\n${clip(input.finalReply, 2_000)}\n</reply>\nMark every step the reply or activity shows as done completed, and leave none in progress.`
      : "The agent is still working: exactly one step is in_progress, the one it is on now.",
    'Reply with JSON only, no prose: {"steps":[{"text":"...","status":"pending"|"in_progress"|"completed"}]}. Use 3 to 7 steps covering the whole task from start to finish, each a concrete outcome under 60 characters ("Render the current machines", "Fix the lang label", "Run the tests"). Mark a step completed only when the activity shows it done.',
  ].join("\n\n");
}

function activityText(lines: readonly string[]): string {
  if (!lines.length) return "(nothing new)";
  const kept = lines.slice(-MAX_ACTIVITY_LINES);
  const dropped = lines.length - kept.length;
  return `${dropped ? `(${dropped} earlier steps not shown)\n` : ""}${kept.join("\n")}`;
}

const STATUSES: readonly TaskListItemStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
];

/** The checklist from the model's reply, or null when it is not usable. */
export function parsePlan(output: string): TaskListItem[] | null {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(output.slice(start, end + 1)) as unknown;
    const steps = (parsed as { steps?: unknown })?.steps;
    if (!Array.isArray(steps)) return null;
    const items = steps.flatMap((step): TaskListItem[] => {
      if (!step || typeof step !== "object") return [];
      const text = (step as { text?: unknown }).text;
      const status = (step as { status?: unknown }).status;
      if (typeof text !== "string" || !text.trim()) return [];
      return [
        {
          text: clip(text, 90),
          status: STATUSES.includes(status as TaskListItemStatus)
            ? (status as TaskListItemStatus)
            : "pending",
        },
      ];
    });
    return items.length ? items.slice(0, 10) : null;
  } catch {
    return null;
  }
}
