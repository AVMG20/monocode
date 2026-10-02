import {
  nativeSessionStatuses,
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

/** Pull current statuses for sessions whose events fired before we listened. */
export async function refreshNativeSessionStatuses(ids: string[]): Promise<void> {
  if (!ids.length) return;
  ensureBridge();
  const current = await nativeSessionStatuses(ids).catch(() => null);
  if (!current) return;
  for (const [id, status] of Object.entries(current)) {
    setNativeSessionStatus(
      id,
      status === "exited" ? null : (status as NativeSessionStatus),
    );
  }
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
 * `running` and later `idle`, or the CLI went away. Providers without status
 * hooks never report `running`, so their turn settles after `fallbackMs`.
 */
export function watchNativeTurn(
  id: string,
  settle: (outcome: NativeTurnOutcome) => void,
  fallbackMs = 30_000,
): () => void {
  let sawRunning = statuses.get(id) === "running";
  let done = false;
  const finish = (outcome: NativeTurnOutcome) => {
    if (done) return;
    done = true;
    listeners.delete(check);
    clearTimeout(timer);
    settle(outcome);
  };
  const check = () => {
    const status = statuses.get(id);
    if (status === "running" || status === "waiting") sawRunning = true;
    else if (sawRunning) finish(status === "idle" ? "completed" : "failed");
  };
  const timer = setTimeout(() => {
    if (!sawRunning) finish("completed");
  }, fallbackMs);
  ensureBridge();
  listeners.add(check);
  return () => {
    done = true;
    listeners.delete(check);
    clearTimeout(timer);
  };
}
