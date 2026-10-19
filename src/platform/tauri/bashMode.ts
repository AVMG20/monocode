import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type BashModeResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

export type BashModeChunk = { stream: "stdout" | "stderr"; data: string };

/** Runs a bash-mode (`!command`) prompt locally in the user's default shell,
 * handing over output as it arrives. */
export async function runBashModeCommand(
  command: string,
  cwd: string | undefined,
  onOutput: (chunk: BashModeChunk) => void,
): Promise<BashModeResult> {
  const id = crypto.randomUUID();
  const unlisten = await listen<BashModeChunk & { id: string }>(
    "bash-mode-output",
    (event) => {
      if (event.payload.id !== id) return;
      onOutput({ stream: event.payload.stream, data: event.payload.data });
    },
  );
  try {
    return await invoke<BashModeResult>("bash_mode_exec", { id, command, cwd });
  } finally {
    unlisten();
  }
}
