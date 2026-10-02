import {
  subscribeNativeSessionStatus,
  type NativeSessionStatus,
} from "../../../platform/tauri/nativeSession";

/**
 * Live status of native CLI sessions (the provider's own TUI running in a
 * PTY), keyed by MonoCode session id. Claude reports through hooks; other
 * providers only ever report `idle` / `exited`.
 */
export type NativeStatusMap = ReadonlyMap<string, NativeSessionStatus>;

let statuses: NativeStatusMap = new Map();
const listeners = new Set<() => void>();
let stopBridge: (() => void) | null = null;

function emit() {
  for (const listener of listeners) listener();
}

export function setNativeSessionStatus(
  id: string,
  status: NativeSessionStatus | null,
): void {
  if ((statuses.get(id) ?? null) === status) return;
  const next = new Map(statuses);
  if (status) next.set(id, status);
  else next.delete(id);
  statuses = next;
  emit();
}

function ensureBridge() {
  if (stopBridge) return;
  stopBridge = subscribeNativeSessionStatus((id, status) =>
    setNativeSessionStatus(id, status === "exited" ? null : status),
  );
}

export function subscribeNativeStatuses(listener: () => void): () => void {
  ensureBridge();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function nativeStatusesSnapshot(): NativeStatusMap {
  return statuses;
}

export function nativeSessionRunning(
  map: NativeStatusMap,
  id: string,
): boolean {
  return map.get(id) === "running";
}

export function nativeSessionWaiting(
  map: NativeStatusMap,
  id: string,
): boolean {
  return map.get(id) === "waiting";
}

export type NativeTurnOutcome = "completed" | "failed";

/**
 * Call `settle` once the session's next agent turn ends: it reported
 * `running` and later `idle`, or the CLI went away.
 *
 * - `hooks`: the CLI reports status (Claude Code). Without hooks a CLI never
 *   reports `running`, so its turn is assumed done after `fallbackMs`.
 * - `maxMs`: a turn still unsettled by then (a hook that never fired, e.g.
 *   after an interrupt) settles as failed so nothing waits forever.
 */
export function watchNativeTurn(
  id: string,
  settle: (outcome: NativeTurnOutcome) => void,
  {
    hooks = false,
    fallbackMs = 30_000,
    maxMs = 6 * 60 * 60_000,
  }: { hooks?: boolean; fallbackMs?: number; maxMs?: number } = {},
): () => void {
  // A turn already in progress is not this prompt's turn: wait for it to
  // end, then for the next one to start.
  let busyBefore = statuses.get(id) === "running";
  let sawRunning = false;
  let done = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const finish = (outcome: NativeTurnOutcome) => {
    if (done) return;
    done = true;
    listeners.delete(check);
    for (const timer of timers) clearTimeout(timer);
    settle(outcome);
  };
  const check = () => {
    const status = statuses.get(id);
    if (busyBefore) {
      if (status !== "running") busyBefore = false;
      if (status === undefined) finish("failed");
      return;
    }
    if (status === "running" || status === "waiting") sawRunning = true;
    else if (sawRunning) finish(status === "idle" ? "completed" : "failed");
  };
  if (!hooks) {
    timers.push(
      setTimeout(() => {
        if (!sawRunning) finish("completed");
      }, fallbackMs),
    );
  }
  timers.push(setTimeout(() => finish("failed"), maxMs));
  ensureBridge();
  listeners.add(check);
  return () => {
    done = true;
    listeners.delete(check);
    for (const timer of timers) clearTimeout(timer);
  };
}

/** Native sessions whose CLI is waiting on the user. */
export function nativeWaitingIds(map: NativeStatusMap = statuses): Set<string> {
  return new Set(
    [...map].flatMap(([id, status]) => (status === "waiting" ? [id] : [])),
  );
}
