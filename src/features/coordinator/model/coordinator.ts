import type { SessionSummary } from "../../sessions/data/sessionStore";
import type {
  Block,
  HarnessId,
  Session,
  TaskListItem,
} from "../../sessions/model/session";
import { sessionDisplayTitle } from "../../sessions/model/session";
import {
  monoCodeToolCall,
  shellWords,
} from "../../sessions/model/monocodeToolCall";
import { unwrapShellCommand } from "../../../integrations/harness/core/shellIntent";
import { isMonoCompletionPrompt } from "../../sessions/model/transcriptActivity";
import { monoState, type MonoLook } from "../../monos/model/mono";
import {
  MEMORY_MAX_LINES,
  memoryWithinBudget,
  type AgentContextPlan,
  type MonoFiles,
} from "../../monos/model/monoFiles";

/**
 * A Claude Project: one coordinator conversation that hands work to threads.
 * The coordinator is a Mono of kind "project" (its chat, memory, instructions
 * and app access come from the Mono machinery); this module adds what makes
 * it a project: the threads it started and where each one stands.
 */

/** Where a thread stands, as the threads sidebar groups them. */
export type ThreadStatus = "waiting" | "busy" | "inactive" | "solved";

export const THREAD_STATUS_ORDER: readonly ThreadStatus[] = [
  "waiting",
  "busy",
  "inactive",
  "solved",
];

export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = {
  waiting: "Waiting for you",
  busy: "Busy",
  inactive: "Inactive",
  solved: "Solved",
};

/** One thread a project owns. */
export type ProjectThread = {
  sessionId: string;
  addedAt: number;
  /** Set when the user (or the coordinator) marked it solved. */
  resolvedAt?: number;
};

/** A thread as the sidebar and the coordinator see it. */
export type ThreadView = {
  sessionId: string;
  title: string;
  status: ThreadStatus;
  /** Short line under the title: what it is doing or last said. */
  activity?: string;
  updatedAt: number;
  harness?: HarnessId;
  model?: string;
  branch?: string;
  additions?: number;
  deletions?: number;
  /** Finished a turn the user has not looked at yet. */
  unseen?: boolean;
  /** The thread's latest step list, when it keeps one. */
  steps?: ThreadSteps;
};

/** Progress through a thread's step list. */
export type ThreadSteps = {
  done: number;
  total: number;
  /** The step in progress, or the next one up. */
  current?: string;
  items: TaskListItem[];
};

/** Inactive threads with no activity for this long count as solved. */
export const AUTO_RESOLVE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The coordinator only routes work, so its own context should stay small:
 * past this many tokens its next turn starts a fresh provider session with a
 * brief of the conversation (see `monoRotation`). Each project can set its
 * own limit (`Mono.compactAt`).
 */
export const COORDINATOR_ROTATE_TOKENS = 250_000;

/** The limits a project can choose from. */
export const COORDINATOR_COMPACT_OPTIONS = [
  100_000, 150_000, 250_000, 400_000, 600_000,
] as const;

/** A project's own limit, or the default when it has none that is valid. */
export function coordinatorCompactAt(limit: number | undefined): number {
  return limit && Number.isFinite(limit) && limit >= 50_000
    ? Math.round(limit)
    : COORDINATOR_ROTATE_TOKENS;
}

/** The point the next turn starts fresh: the limit, or 80% of a smaller window. */
function rotateAt(usage: { window?: number }, limit: number): number {
  return usage.window && usage.window > 0
    ? Math.min(limit, Math.floor(usage.window * 0.8))
    : limit;
}

/** Bumped when the coordinator's fixed rules change, so live chats get them again. */
export const COORDINATOR_PROMPT_VERSION = 5;

const THREADS_KEY = "monocode:coordinator-threads";
const THREADS_CHANGED = "monocode:coordinator-threads-changed";

type ThreadRegistry = Record<string, ProjectThread[]>;

function readRegistry(): ThreadRegistry {
  try {
    const parsed = JSON.parse(localStorage.getItem(THREADS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out: ThreadRegistry = {};
    for (const [projectId, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue;
      out[projectId] = list.flatMap((entry): ProjectThread[] => {
        if (
          !entry ||
          typeof entry !== "object" ||
          typeof entry.sessionId !== "string" ||
          !entry.sessionId
        )
          return [];
        return [
          {
            sessionId: entry.sessionId,
            addedAt: typeof entry.addedAt === "number" ? entry.addedAt : 0,
            ...(typeof entry.resolvedAt === "number"
              ? { resolvedAt: entry.resolvedAt }
              : {}),
          },
        ];
      });
    }
    return out;
  } catch {
    return {};
  }
}

function writeRegistry(registry: ThreadRegistry): void {
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(registry));
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(THREADS_CHANGED));
}

function changeThreads(
  projectId: string,
  change: (threads: ProjectThread[]) => ProjectThread[],
): void {
  const registry = readRegistry();
  const current = registry[projectId] ?? [];
  const next = change(current);
  if (
    next.length === current.length &&
    next.every((thread, index) => thread === current[index])
  )
    return;
  registry[projectId] = next;
  writeRegistry(registry);
}

/** The threads a project owns, oldest first. */
export function listProjectThreads(projectId: string): ProjectThread[] {
  return readRegistry()[projectId] ?? [];
}

/** Adds a session to a project's threads; a known one is left as it is. */
export function addProjectThread(
  projectId: string,
  sessionId: string,
  now = Date.now(),
): void {
  changeThreads(projectId, (threads) =>
    threads.some((thread) => thread.sessionId === sessionId)
      ? threads
      : [...threads, { sessionId, addedAt: now }],
  );
}

/** Marks a thread solved, or opens it again. */
export function resolveProjectThread(
  projectId: string,
  sessionId: string,
  resolved: boolean,
  now = Date.now(),
): void {
  changeThreads(projectId, (threads) =>
    threads.map((thread) => {
      if (thread.sessionId !== sessionId) return thread;
      if (resolved === !!thread.resolvedAt) return thread;
      if (resolved) return { ...thread, resolvedAt: now };
      const { resolvedAt: _resolved, ...open } = thread;
      return open;
    }),
  );
}

/** Drops a thread from its project, e.g. after its session was deleted. */
export function removeProjectThread(sessionId: string): void {
  const registry = readRegistry();
  let changed = false;
  for (const [projectId, threads] of Object.entries(registry)) {
    const next = threads.filter((thread) => thread.sessionId !== sessionId);
    if (next.length !== threads.length) {
      registry[projectId] = next;
      changed = true;
    }
  }
  if (changed) writeRegistry(registry);
}

/** Forgets every thread of a removed project; the sessions themselves stay. */
export function forgetProjectThreads(projectId: string): void {
  const registry = readRegistry();
  if (!(projectId in registry)) return;
  delete registry[projectId];
  writeRegistry(registry);
}

/** Every session that is some project's thread. */
export function allProjectThreadIds(): Set<string> {
  return new Set(
    Object.values(readRegistry()).flatMap((threads) =>
      threads.map((thread) => thread.sessionId),
    ),
  );
}

/** The project a thread belongs to, if any. */
export function projectForThread(sessionId: string): string | undefined {
  for (const [projectId, threads] of Object.entries(readRegistry())) {
    if (threads.some((thread) => thread.sessionId === sessionId))
      return projectId;
  }
  return undefined;
}

export function subscribeProjectThreads(onChange: () => void): () => void {
  window.addEventListener(THREADS_CHANGED, onChange);
  return () => window.removeEventListener(THREADS_CHANGED, onChange);
}

/** Snapshot for `useSyncExternalStore`; stable while storage is unchanged. */
export function projectThreadsSnapshot(): string {
  try {
    return localStorage.getItem(THREADS_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Plain one-line text, clipped. */
export function oneLine(text: string, max = 140): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|>)\s*/gm, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** The thread's latest step list (its todo list), if it keeps one. */
export function threadSteps(blocks: readonly Block[]): ThreadSteps | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const items =
      blocks[i].role === "tasks" ? blocks[i].taskList?.items : undefined;
    if (items?.length) return stepsOf(items);
  }
  return undefined;
}

/** Progress through a list of steps. */
export function stepsOf(items: TaskListItem[]): ThreadSteps {
  const counted = items.filter((item) => item.status !== "cancelled");
  const done = counted.filter((item) => item.status === "completed").length;
  const current =
    counted.find((item) => item.status === "in_progress") ??
    counted.find((item) => item.status === "pending");
  return {
    done,
    total: counted.length,
    ...(current ? { current: current.text } : {}),
    items,
  };
}

/** The first line of what the thread last said, for an idle thread's card. */
function lastReply(session: Pick<Session, "blocks">): string | undefined {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role === "user" && !block.internal) return undefined;
    if (
      block.role === "assistant" &&
      !block.tool &&
      !block.streaming &&
      block.text.trim()
    ) {
      const first = block.text.trim().split(/\n\s*\n/)[0] ?? "";
      return oneLine(first) || undefined;
    }
  }
  return undefined;
}

type ThreadSession = Pick<
  Session,
  | "id"
  | "title"
  | "blocks"
  | "busy"
  | "pendingQuestion"
  | "worktreeRemoved"
  | "usageLimit"
  | "harness"
  | "model"
  | "branch"
>;

/**
 * Where one thread stands. A live session decides from its state; one that
 * is not loaded falls back to its saved summary. Busy and needing the user
 * always win over solved, so a solved thread that picks up work shows again.
 */
export function threadView(input: {
  thread: ProjectThread;
  session?: ThreadSession;
  summary?: SessionSummary;
  unseen?: boolean;
  now?: number;
  /** Last known steps of a thread that is not loaded. */
  steps?: ThreadSteps;
}): ThreadView {
  const { thread, session, summary, unseen = false } = input;
  const steps = session ? threadSteps(session.blocks) : input.steps;
  const now = input.now ?? Date.now();
  const lastBlockAt = session?.blocks.reduce(
    (latest, block) => Math.max(latest, block.startedAt ?? 0),
    0,
  );
  const updatedAt = Math.max(
    summary?.updatedAt ?? 0,
    lastBlockAt ?? 0,
    thread.addedAt,
  );
  const base = {
    sessionId: thread.sessionId,
    title: threadTitle(session?.title?.trim() ? session : summary),
    updatedAt,
    harness: session?.harness ?? summary?.harness,
    model: session?.model ?? summary?.model,
    branch: session?.branch ?? summary?.branch,
    additions: summary?.additions,
    deletions: summary?.deletions,
    ...(unseen ? { unseen: true } : {}),
    ...(steps ? { steps } : {}),
  };
  if (session) {
    const state = monoState(session);
    if (state.status === "needs-you")
      return { ...base, status: "waiting", activity: state.activity };
    if (state.status === "working")
      return {
        ...base,
        status: "busy",
        // The step it is on says more than the tool it is running.
        activity: steps?.current ?? state.activity,
      };
  }
  const reply = session ? lastReply(session) : undefined;
  if (thread.resolvedAt || summary?.archived)
    return { ...base, status: "solved", activity: reply };
  // A finished reply nobody has read yet waits for the user, however old.
  if (unseen)
    return {
      ...base,
      status: "waiting",
      activity: reply ?? "Ready for review",
    };
  if (now - updatedAt > AUTO_RESOLVE_MS)
    return { ...base, status: "solved", activity: reply };
  return { ...base, status: "inactive", activity: reply };
}

/** A thread's name without the harness prefix session titles carry. */
function threadTitle(
  source: Pick<Session, "title" | "harness"> | undefined,
): string {
  const title = source?.title?.trim();
  if (!title) return "Untitled thread";
  return (
    sessionDisplayTitle(title, source!.harness).trim() || "Untitled thread"
  );
}

/** Threads by status, most recently active first within each. */
export function groupThreads(
  views: readonly ThreadView[],
): Record<ThreadStatus, ThreadView[]> {
  const groups: Record<ThreadStatus, ThreadView[]> = {
    waiting: [],
    busy: [],
    inactive: [],
    solved: [],
  };
  for (const view of views) groups[view.status].push(view);
  for (const status of THREAD_STATUS_ORDER)
    groups[status].sort((a, b) => b.updatedAt - a.updatedAt);
  return groups;
}

/**
 * The coordinator's context against the budget it works within, so the meter
 * reads 100% where its next turn starts fresh rather than at the model's full
 * window.
 */
export function coordinatorContextUsage(
  usage: Session["context"],
  limit = COORDINATOR_ROTATE_TOKENS,
): Session["context"] {
  if (!usage) return undefined;
  return { used: usage.used, window: rotateAt(usage, limit) };
}

/** Whether the coordinator's next turn should start a fresh provider session. */
export function coordinatorOverBudget(
  session: Pick<Session, "providerSessionId" | "context">,
  limit = COORDINATOR_ROTATE_TOKENS,
): boolean {
  if (!session.providerSessionId || !session.context) return false;
  return session.context.used >= rotateAt(session.context, limit);
}

const RECENT_SOLVED = 5;

/** The project's threads as the coordinator reads them at the start of a turn. */
export function threadsBrief(views: readonly ThreadView[]): string {
  const groups = groupThreads(views);
  const lines: string[] = [];
  for (const status of THREAD_STATUS_ORDER) {
    const list =
      status === "solved"
        ? groups.solved.slice(0, RECENT_SOLVED)
        : groups[status];
    for (const view of list) {
      const activity = view.activity ? ` — ${oneLine(view.activity, 160)}` : "";
      const branch = view.branch ? ` [${view.branch}]` : "";
      lines.push(
        `- ${view.sessionId} · ${THREAD_STATUS_LABEL[status]} · "${oneLine(view.title, 100)}"${branch}${activity}`,
      );
    }
  }
  const hidden =
    groups.solved.length - Math.min(groups.solved.length, RECENT_SOLVED);
  return `<project_threads>\n${
    lines.length
      ? lines.join("\n")
      : "(No threads yet. Start one with app sessions.start when there is work to do.)"
  }${hidden > 0 ? `\n(${hidden} older solved threads not listed; app sessions.list shows every session.)` : ""}\n</project_threads>`;
}

/**
 * The coordinator's standing prompt: how it routes work. It is the same for
 * every project, so it can improve in one place; a project adds its own
 * instructions instead. {{project}}, {{folders}} and {{path}} are filled in
 * with the project's name, its folders and its main folder.
 */
const COORDINATOR_PROMPT = `You are the coordinator of the project "{{project}}" in MonoCode. Its code lives in:
{{folders}}
Pass "project":"{{path}}" to app CLI calls. Every call takes its input as JSON after --json, and fields it does not list in \`app --help\` are rejected.

This is one long conversation the user keeps coming back to. You do not do the work yourself: threads do. A thread is an ordinary MonoCode session with its own context window, started and steered through the app CLI. Your job is to route, keep track and report, and to keep this conversation small and fast.

For every message, pick exactly one of these and then end your turn:
1. Answer directly. Quick questions about the project, the state of its work, or what a thread did: answer from the thread list below, your memory, or by reading a little of a thread with \`app sessions.read --json '{"sessionId":"<id>"}'\` (its latest exchanges only; ask for older ones only if needed). Do not open files or run commands to answer; if a question needs real digging, it is work for a thread.
2. Forward to an existing thread. When the request belongs to work a thread already owns (same feature, same branch, a follow-up or correction), send it there with \`app sessions.send --json '{"sessionId":"<id>","prompt":"<the user's request, with any context the thread needs>","notifyOnComplete":true}'\`. Pass the user's words on faithfully; add context, do not rewrite their intent. This includes solved threads: a thread left inactive for three days is marked solved, and a follow-up you send it reopens it. If the thread is busy, the result says "queued": it gets the message after its current turn, and no completion report follows for a queued message, so say so.
3. Start a new thread. For new work, call \`app sessions.start --json '{"title":"<3 to 6 word name>","prompt":"...","notifyOnComplete":true}'\` with a short title the user will recognise in the thread list and a clear, self-contained prompt: the goal, relevant context from this conversation, constraints, what it may change and how to check its work. Give each thread a separate worktree ("workspaceMode":"worktree") when other threads may edit the same code at the same time. Split truly independent parts into separate threads in the same turn.

Whenever you name a thread in chat, link it by its id: [<its title>](#thread-<sessionId>). MonoCode shows that link as the thread with its live status, and the user opens the thread by clicking it.

Your replies are one or two short sentences, like a colleague answering in chat. The details live in the threads: MonoCode shows each thread you start or message as a card under your reply with its live progress and latest reply, and shows the card again under your reply to its completion report, and the user opens a thread to read the rest. So never repeat a thread's prompt, findings, recommendation, lists or open questions in chat. No headings, bold labels, bullet lists or recaps of earlier messages. Some examples of the right length:
- Starting a thread: "Shouldn't be too bad, starting on it."
- Forwarding: "Added to [Servo drill sneak modes](#thread-<id>), so sneak can be set to any of the drill's modes."
- Answering: "I sent it to [Solar panel balance](#thread-<id>) to check. My guess is the tooltip shows your saved config value."
- Completion report: "[ST-169 research](#thread-<id>) is done and the card is in review. It recommends a forward button and has five questions for you in the thread."

After forwarding or starting, say which thread has it (linked as above) and stop. Threads lay out their work as a step list the user can follow; you do not need to ask them to. Never wait, poll or do the thread's work in parallel. When a completion report arrives, these rules override its wording: read only what you need, then say in a sentence or two what came out of it and whether something needs the user (a decision, a review, a permission), pointing to the thread for the details rather than relaying them. A link the user needs (a PR, an artifact) may go in that sentence. When several threads report together, give each one sentence at most, and skip the ones with nothing for the user.

Do not edit code, run builds or tests, or read the codebase yourself; threads have the full tools for that. You may read a thread's conversation, list sessions, archive a thread the user says is done, and manage memory.`;

/** The prompt with the project's details filled in. */
export function renderCoordinatorPrompt(
  look: Pick<MonoLook, "name" | "projects">,
): string {
  const folders = look.projects.length
    ? look.projects.map((entry) => `- ${entry.name}: ${entry.path}`).join("\n")
    : "(no folder yet)";
  return COORDINATOR_PROMPT.split("{{project}}")
    .join(look.name)
    .split("{{folders}}")
    .join(folders)
    .split("{{path}}")
    .join(look.projects[0]?.path ?? "");
}

/** The coordinator's fixed rules and project knowledge, handed with a turn. */
export function coordinatorContext(
  look: MonoLook,
  files: MonoFiles,
  plan: AgentContextPlan,
): string {
  const parts: string[] = [];
  if (plan.soul) {
    parts.push(
      `<project_coordinator>\n${renderCoordinatorPrompt(look)}\n</project_coordinator>`,
      `<project_instructions>\nThe project's standing instructions, from its settings. They apply to you and every thread: include the parts that matter in the prompts you send. They rank below the user's current request. Change them only when the user asks: read them with \`app soul.read --json '{}'\` and save the complete text with \`app soul.update --json '{"text":"...","expectedHash":"<hash>"}'\`.\n\n${files.soul.trim()}\n</project_instructions>`,
      `<memory_rules>\nThe project has a memory that carries across conversations and rotations of this chat. Its first ${MEMORY_MAX_LINES} lines load whenever it changes, so keep it to facts that stay useful: decisions, preferences (like how many threads to run at once), how the project works, open questions. Save them as you learn them, through the app CLI only: \`app memory.add {"fact":"..."}\`, \`app memory.replace {"find":"...","fact":"..."}\`, \`app memory.remove {"find":"..."}\`, \`app memory.search {"query":"..."}\`. Never save secrets.\n</memory_rules>`,
    );
  }
  if (plan.memory) {
    const budget = memoryWithinBudget(files.memory);
    parts.push(
      `<memory>\n${budget.text || "(Empty. Nothing has been remembered yet.)"}${
        files.topics.length
          ? `\n\nTopic notes, read on demand with memory.read: ${files.topics.join(", ")}`
          : ""
      }\n</memory>`,
    );
  }
  return parts.join("\n\n");
}

/**
 * One piece of work the coordinator handed to a thread in a turn, or a
 * thread's report on it coming back.
 */
export type ThreadHandoff = {
  kind: "start" | "send" | "report";
  /** The thread, once the app accepted the call. */
  sessionId?: string;
  /** What the coordinator told the thread; empty for a report. */
  prompt: string;
  /** How the reported run ended. */
  outcome?: "completed" | "failed" | "cancelled";
  /** Waiting for a busy thread to finish its turn. */
  queued?: boolean;
  /** The call failed; nothing was handed over. */
  failed?: boolean;
  /** Still running. */
  pending?: boolean;
};

function jsonArg(
  words: readonly string[],
): Record<string, unknown> | undefined {
  const index = words.indexOf("--json");
  const raw = index >= 0 ? words[index + 1] : undefined;
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function receipt(
  detail: string | undefined,
): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  try {
    const value = JSON.parse(detail.trim());
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The threads the coordinator started or messaged in one turn, with what it
 * told them, read from its app CLI calls and their receipts, and the threads
 * whose completion reports the turn answers.
 */
export function threadHandoffs(turn: readonly Block[]): ThreadHandoff[] {
  return turn.flatMap(blockHandoff);
}

/** Blocks are immutable, so each call is parsed once. */
const handoffCache = new WeakMap<Block, ThreadHandoff[]>();

function blockHandoff(block: Block): ThreadHandoff[] {
  const cached = handoffCache.get(block);
  if (cached) return cached;
  const found = isMonoCompletionPrompt(block)
    ? parseReports(block)
    : parseHandoff(block);
  const out = Array.isArray(found) ? found : found ? [found] : [];
  handoffCache.set(block, out);
  return out;
}

const OUTCOMES = new Set(["completed", "failed", "cancelled"]);

/** The threads in a completion report: one, or a group sent together. */
function parseReports(block: Block): ThreadHandoff[] {
  const report = (sessionId: unknown, status: unknown): ThreadHandoff[] =>
    typeof sessionId === "string" && sessionId
      ? [
          {
            kind: "report",
            sessionId,
            prompt: "",
            ...(typeof status === "string" && OUTCOMES.has(status)
              ? { outcome: status as ThreadHandoff["outcome"] }
              : {}),
          },
        ]
      : [];
  // The results follow the notice as one JSON object.
  const start = block.text.indexOf("\n\n{");
  let payload: Record<string, unknown> | undefined;
  try {
    const value = start >= 0 ? JSON.parse(block.text.slice(start + 2)) : null;
    if (value && typeof value === "object") payload = value;
  } catch {
    payload = undefined;
  }
  if (Array.isArray(payload?.sessions))
    return payload.sessions.flatMap((entry: unknown) =>
      entry && typeof entry === "object"
        ? report(
            (entry as Record<string, unknown>).sessionId,
            (entry as Record<string, unknown>).status,
          )
        : [],
    );
  if (payload?.sessionId) return report(payload.sessionId, payload.status);
  const marker = block.monoSessionCompletion;
  return marker && !marker.sessionCount
    ? report(marker.sessionId, marker.status)
    : [];
}

function parseHandoff(block: Block): ThreadHandoff | undefined {
  if (!block.tool) return undefined;
  const command =
    block.tool.preview?.kind === "shell"
      ? block.tool.preview.title
      : (block.tool.title ?? block.text);
  if (!command) return undefined;
  const unwrapped = unwrapShellCommand(command);
  const call = monoCodeToolCall({
    ...block,
    tool: { ...block.tool, preview: { kind: "shell", title: unwrapped } },
  });
  if (call?.action !== "sessions.start" && call?.action !== "sessions.send")
    return undefined;
  const input = jsonArg(shellWords(call.command) ?? []);
  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return undefined;
  const status = block.tool.status ?? "";
  const result = receipt(block.tool.detail);
  const body =
    result?.result && typeof result.result === "object"
      ? (result.result as Record<string, unknown>)
      : undefined;
  const sessionId =
    call.action === "sessions.start"
      ? typeof body?.id === "string"
        ? body.id
        : undefined
      : typeof input?.sessionId === "string"
        ? input.sessionId
        : undefined;
  const pending = ![
    "completed",
    "success",
    "failed",
    "error",
    "cancelled",
  ].includes(status);
  // A receipt that did not parse (cut short, say) is not a failure.
  const failed =
    !pending &&
    (["failed", "error", "cancelled"].includes(status) || result?.ok === false);
  return {
    kind: call.action === "sessions.start" ? "start" : "send",
    ...(sessionId && !failed ? { sessionId } : {}),
    prompt,
    ...(body?.queued === true ? { queued: true } : {}),
    ...(failed ? { failed: true } : {}),
    ...(pending ? { pending: true } : {}),
  };
}

/** How an agent keeps the task list the user follows it by. */
const STEP_LIST_RULES = `Before you start working on a message, lay out the steps you will take as a task list with your task tools (TaskCreate for each step and TaskUpdate as you go; TodoWrite if that is the tool you have), short and concrete, and keep it current: mark each step in progress when you start it and completed when it is done, adding or removing steps when the plan changes. Even a short, read-only task gets a few steps. The list shows the work at hand, so keep it short rather than letting it grow: when a follow-up or a message that arrives while you are working only extends the current work, add its steps to the list and rename or delete (TaskUpdate with status "deleted") the steps it changes; when it is new work, close out the old list first (mark the finished steps completed and delete the rest), and the first step you create after that starts a fresh list. When several requests arrive together, cover all of them.`;

/**
 * What a thread is told along with each message its coordinator sends, so
 * its work reads as steps the user can follow.
 */
export function threadRules(projectName: string): string {
  return `<project_thread>\nYou are a thread in the project "${projectName}": the user, or the project's coordinator on their behalf, sends you work, and the user follows your progress in MonoCode's threads view through your task list. ${STEP_LIST_RULES} Ask the user when a decision is genuinely theirs. When you are done, end with a short summary of what changed, how you checked it, and anything that needs the user (a decision, a review, a merge).\n</project_thread>`;
}

/**
 * Asks a plain session to work in visible steps, when the user turned the
 * step list on for sessions.
 */
export function sessionStepRules(): string {
  return `<session_steps>\nThe user follows your progress in MonoCode through your task list, pinned above this conversation. ${STEP_LIST_RULES}\n</session_steps>`;
}
