import type { BashRun, Block } from "./session";

/** Matches Claude Code's default cap on shell output it hands the model. */
export const BASH_MAX_OUTPUT_CHARS = 30_000;

/** Keeps the head and tail of long output; the transcript still shows it all. */
export function truncateBashOutput(text: string): string {
  if (text.length <= BASH_MAX_OUTPUT_CHARS) return text;
  const half = BASH_MAX_OUTPUT_CHARS / 2;
  const cut = text.slice(half, text.length - half);
  const lines = cut.split("\n").length - 1;
  return `${text.slice(0, half)}\n\n... [${cut.length} characters, ${lines} lines truncated] ...\n\n${text.slice(text.length - half)}`;
}

/** Claude Code's own transcript shape for a bash-mode run. */
export function formatBashRun(run: BashRun): string {
  const stderr = run.timedOut
    ? `${run.stderr}${run.stderr ? "\n" : ""}Command timed out`
    : run.stderr;
  const stdout = truncateBashOutput(run.stdout.trimEnd());
  return `<bash-input>${run.command}</bash-input>\n<bash-stdout>${stdout}</bash-stdout><bash-stderr>${truncateBashOutput(stderr.trimEnd())}</bash-stderr>`;
}

/** Runs since the last sent user message, which the agent has not seen. */
export function unsentBashRuns(blocks: readonly Block[]): BashRun[] {
  const runs: BashRun[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user" && !block.draft) break;
    if (block.role === "bash" && block.bash) runs.unshift(block.bash);
  }
  return runs;
}

/** What the agent receives for the unsent runs, in Claude Code's own shape. */
export function pendingBashContext(blocks: readonly Block[]): string {
  const runs = unsentBashRuns(blocks)
    .filter((run) => run.status !== "running")
    .map(formatBashRun);
  return runs.length ? `${runs.join("\n\n")}\n\n` : "";
}
