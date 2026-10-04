import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchClaude = vi.fn();
const accountExists = vi.fn(() => true);

vi.mock("./providerAccounts", () => ({
  providerAccountExists: () => accountExists(),
}));

vi.mock("./rateLimitsFetch", () => ({
  fetchClaudeRateLimits: (accountId: string) => fetchClaude(accountId),
  fetchCodexRateLimits: vi.fn(),
  fetchOpencodeGoRateLimits: vi.fn(),
}));

import { clearCachedRateLimits, loadRateLimits } from "./rateLimitsCache";
import {
  ACTIVE_USAGE_POLL_MS,
  setWorkingUsageAccounts,
  stopUsagePolling,
} from "./rateLimitsPolling";

const claude = { provider: "claude" as const, accountId: "default" };

function okLimits() {
  return {
    provider: "claude",
    session: null,
    weekly: null,
    monthly: null,
    resetCredits: null,
    updatedAt: Date.now(),
    error: null,
    status: "ok",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchClaude.mockReset();
  accountExists.mockReturnValue(true);
  fetchClaude.mockImplementation(async () => okLimits());
});

afterEach(() => {
  stopUsagePolling();
  clearCachedRateLimits();
  vi.useRealTimers();
});

describe("usage polling", () => {
  it("refreshes right away when a session starts on a stale account", async () => {
    setWorkingUsageAccounts([claude]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchClaude).toHaveBeenCalledTimes(1);
  });

  it("waits out the interval when the last refresh is recent", async () => {
    await loadRateLimits("claude", "default");
    await vi.advanceTimersByTimeAsync(30_000);
    setWorkingUsageAccounts([claude]);
    await vi.advanceTimersByTimeAsync(ACTIVE_USAGE_POLL_MS - 30_001);
    expect(fetchClaude).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchClaude).toHaveBeenCalledTimes(2);
  });

  it("keeps polling while working and finishes one poll after stopping", async () => {
    setWorkingUsageAccounts([claude]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(ACTIVE_USAGE_POLL_MS);
    expect(fetchClaude).toHaveBeenCalledTimes(2);

    setWorkingUsageAccounts([]);
    await vi.advanceTimersByTimeAsync(ACTIVE_USAGE_POLL_MS);
    expect(fetchClaude).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(ACTIVE_USAGE_POLL_MS * 5);
    expect(fetchClaude).toHaveBeenCalledTimes(3);
  });

  it("pushes the next poll back after a refresh from elsewhere", async () => {
    setWorkingUsageAccounts([claude]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(ACTIVE_USAGE_POLL_MS - 10_000);
    await loadRateLimits("claude", "default", true);
    expect(fetchClaude).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchClaude).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(ACTIVE_USAGE_POLL_MS - 10_000);
    expect(fetchClaude).toHaveBeenCalledTimes(3);
  });

  it("joins a fetch already in flight instead of queueing another", async () => {
    let finish: (value: unknown) => void = () => {};
    fetchClaude.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    void loadRateLimits("claude", "default");
    setWorkingUsageAccounts([claude]);
    await vi.advanceTimersByTimeAsync(0);
    finish(okLimits());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchClaude).toHaveBeenCalledTimes(1);
  });

  it("stops polling an account that was removed", async () => {
    setWorkingUsageAccounts([claude]);
    await vi.advanceTimersByTimeAsync(0);
    accountExists.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(ACTIVE_USAGE_POLL_MS * 3);
    expect(fetchClaude).toHaveBeenCalledTimes(1);
  });
});
