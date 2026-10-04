import type { RateLimitProvider } from "./rateLimits";
import {
  lastRateLimitsRefresh,
  loadRateLimits,
  pendingRateLimits,
} from "./rateLimitsCache";
import { providerAccountExists } from "./providerAccounts";

/** Usage refreshes this often while a session on the account is working. */
export const ACTIVE_USAGE_POLL_MS = 2 * 60_000;

export type UsageAccount = {
  provider: Extract<RateLimitProvider, "claude" | "codex">;
  accountId: string;
};

const working = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function keyFor({ provider, accountId }: UsageAccount): string {
  return `${provider}:${accountId}`;
}

/** Time left until the account is due, measured from its last refresh. */
function dueIn({ provider, accountId }: UsageAccount): number {
  const last = lastRateLimitsRefresh(provider, accountId);
  return last === null
    ? 0
    : Math.max(0, last + ACTIVE_USAGE_POLL_MS - Date.now());
}

function schedule(account: UsageAccount, delay: number): void {
  timers.set(
    keyFor(account),
    setTimeout(() => void poll(account), delay),
  );
}

// A session finishing leaves its scheduled poll in place. That final poll
// catches the completed turn's usage, then stops unless work has resumed.
// Refreshes from elsewhere (the footer button, Settings) push the poll back
// instead of doubling up.
async function poll(account: UsageAccount): Promise<void> {
  const key = keyFor(account);
  const { provider, accountId } = account;
  if (!providerAccountExists(provider, accountId)) {
    timers.delete(key);
    return;
  }
  const running = pendingRateLimits(provider, accountId);
  const delay = dueIn(account);
  if (!running && delay > 0) return schedule(account, delay);
  await (running ?? loadRateLimits(provider, accountId, true));
  timers.delete(key);
  if (working.has(key)) schedule(account, dueIn(account));
}

/** Report the accounts that currently have a working session. A newly
 *  working account refreshes right away when its usage is stale. */
export function setWorkingUsageAccounts(accounts: UsageAccount[]): void {
  working.clear();
  for (const account of accounts) {
    const key = keyFor(account);
    working.add(key);
    if (!timers.has(key)) schedule(account, dueIn(account));
  }
}

/** Used by tests and hot reloads that need a clean scheduler. */
export function stopUsagePolling(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  working.clear();
}

import.meta.hot?.dispose(stopUsagePolling);
