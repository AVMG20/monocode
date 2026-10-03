import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { markPtyOpened } from "./pty";

/**
 * Native provider sessions run the provider's own interactive CLI in a PTY.
 * The PTY shares the regular terminal id space: use `subscribePty`,
 * `writePty`, `resizePty` and `killPty` from `./pty` with the session id.
 */
export type NativeProviderId = "claude" | "codex" | "opencode" | "antigravity";

export type NativeSessionStatus = "idle" | "running" | "waiting" | "exited";

export type NativeProvider = {
  id: NativeProviderId;
  installed: boolean;
  path?: string | null;
};

export type SpawnNativeSessionArgs = {
  /** PTY id; the MonoCode session id. */
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  provider: NativeProviderId;
  accountId?: string;
  /** Claude: the conversation UUID (resumed when its transcript exists). */
  conversationId: string;
  /** Codex / OpenCode: continue the most recent conversation. */
  resume: boolean;
  /** First prompt handed to the CLI on its command line. */
  initialPrompt?: string;
};

export type NativeSpawnResult = {
  resumed: boolean;
  /** False when the CLI takes no prompt argument; type it into the TUI. */
  promptDelivered: boolean;
};

type StatusPayload = { id: string; status: NativeSessionStatus };

export async function listNativeProviders(): Promise<NativeProvider[]> {
  return invoke<NativeProvider[]>("native_session_providers");
}

export async function spawnNativeSession(
  args: SpawnNativeSessionArgs,
): Promise<NativeSpawnResult> {
  markPtyOpened(args.id);
  return invoke<NativeSpawnResult>("native_session_spawn", {
    id: args.id,
    cwd: args.cwd,
    cols: args.cols,
    rows: args.rows,
    provider: args.provider,
    accountId: args.accountId ?? null,
    conversationId: args.conversationId,
    resume: args.resume,
    initialPrompt: args.initialPrompt ?? null,
  });
}

/** Current status of each id that is still a live native session. */
export async function nativeSessionStatuses(
  ids: string[],
): Promise<Record<string, NativeSessionStatus>> {
  if (ids.length === 0) return {};
  return invoke<Record<string, NativeSessionStatus>>("native_session_status", {
    ids,
  });
}

export function subscribeNativeSessionStatus(
  handler: (id: string, status: NativeSessionStatus) => void,
): () => void {
  let disposed = false;
  const pending = listen<StatusPayload>("native-session-status", (event) => {
    if (disposed) return;
    handler(event.payload.id, event.payload.status);
  });
  return () => {
    disposed = true;
    void pending.then((unlisten) => unlisten()).catch(() => undefined);
  };
}
