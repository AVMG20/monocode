import { tempDir } from "@tauri-apps/api/path";
import {
  killChild,
  resolveClaudeBinary,
  spawnChild,
  watchChild,
  writeChild,
} from "../../core/child";
import {
  buildClaudeSpawnArgs,
  buildClaudeUserMessage,
  parseJsonLine,
} from "./claudeProtocol";
import { pickTextModel } from "./claudeText";

let sequence = 0;
let neutralDir: Promise<string | undefined> | undefined;

/** A folder with no CLAUDE.md, so none is read into the request. */
function neutralCwd(): Promise<string | undefined> {
  neutralDir ??= tempDir().catch(() => undefined);
  return neutralDir;
}

function assistantText(rec: Record<string, unknown>): string {
  const message = rec.message as { content?: unknown } | undefined;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .flatMap((part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
        ? [(part as { text: string }).text]
        : [],
    )
    .join("");
}

/**
 * One small, self-contained request to Claude's fast model: a fresh process
 * and context each time, no tools, no project memory and a one-line system
 * prompt in place of Claude Code's, so it costs little more than the prompt.
 * Unlike the shared text helper, nothing accumulates between requests.
 */
export async function runClaudeOneShot(input: {
  prompt: string;
  system: string;
  providerAccountId?: string;
  /** Used only when no neutral folder is available. */
  fallbackCwd: string;
  timeoutMs?: number;
}): Promise<string> {
  const { path } = await resolveClaudeBinary();
  const cwd = (await neutralCwd()) ?? input.fallbackCwd;
  const id = `monocode-claude-oneshot-${++sequence}`;
  const args = [
    ...buildClaudeSpawnArgs({
      isolated: true,
      model: pickTextModel(),
      includePartialMessages: false,
    }),
    "--tools",
    "",
    "--system-prompt",
    input.system,
    "--disable-slash-commands",
  ];
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let text = "";
    const finish = (error: Error | null, output = "") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      void killChild(id).catch(() => undefined);
      if (error) reject(error);
      else resolve(output);
    };
    const timer = window.setTimeout(
      () => finish(new Error("Claude request timed out")),
      input.timeoutMs ?? 40_000,
    );
    watchChild(
      id,
      (line) => {
        const rec = parseJsonLine(line);
        if (!rec) return;
        if (rec.type === "assistant") text += assistantText(rec);
        if (rec.type !== "result") return;
        if (rec.subtype === "success")
          finish(null, typeof rec.result === "string" ? rec.result : text);
        else finish(new Error(`Claude request failed: ${String(rec.subtype)}`));
      },
      () => finish(new Error("Claude exited before answering")),
    );
    spawnChild(
      id,
      path,
      args,
      cwd,
      { provider: "claude", id: input.providerAccountId ?? "default" },
      "claude",
    )
      .then(() =>
        writeChild(
          id,
          JSON.stringify(buildClaudeUserMessage({ text: input.prompt })),
        ),
      )
      .catch((error: unknown) =>
        finish(error instanceof Error ? error : new Error(String(error))),
      );
  });
}
