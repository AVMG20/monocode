import { beforeEach, describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  live: 0,
  maxLive: 0,
  spawned: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({
  homeDir: async () => "/home/test",
}));
vi.mock("../../../integrations/harness/core/child", () => ({
  resolveCodexBinary: async () => ({ path: "/bin/codex" }),
  spawnChild: async (
    _id: string,
    _path: string,
    _args: string[],
    _cwd: string,
    account: { id: string },
  ) => {
    child.live += 1;
    child.maxLive = Math.max(child.maxLive, child.live);
    child.spawned.push(account.id);
  },
  watchChild: () => undefined,
  unwatchChild: () => {
    child.live = Math.max(0, child.live - 1);
  },
  killChild: async () => undefined,
}));
vi.mock("../../../integrations/harness/core/jsonRpc", () => ({
  JsonRpcClient: class {
    close() {}
    pushLine() {}
    respond() {
      return Promise.resolve();
    }
    notify() {
      return Promise.resolve();
    }
    async request(method: string) {
      if (method !== "account/rateLimits/read") return {};
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        rateLimits: {
          primary: { usedPercent: 10, windowDurationMins: 300 },
        },
      };
    }
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { fetchClaudeRateLimits, fetchCodexRateLimits } from "./rateLimitsFetch";

describe("fetchClaudeRateLimits", () => {
  const endpoint = "API token · gw.example.dev";

  it("reads a gateway's usage in Claude's layout", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      status: "ok",
      endpoint,
      body: JSON.stringify({
        five_hour: { utilization: 42, resets_at: null },
        seven_day: null,
      }),
    });
    const limits = await fetchClaudeRateLimits("account-gw");
    expect(limits.status).toBe("ok");
    expect(limits.session?.usedPercent).toBe(42);
  });

  it("reads a gateway with nothing to report as a working token", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      status: "ok",
      endpoint,
      body: JSON.stringify({ five_hour: null, seven_day: null }),
    });
    const limits = await fetchClaudeRateLimits("account-gw");
    expect(limits.status).toBe("untracked");
    expect(limits.error).toBe(endpoint);
  });

  it("reads a token profile without a usage URL as untracked", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ status: "endpoint", endpoint });
    const limits = await fetchClaudeRateLimits("account-gw");
    expect(limits.status).toBe("untracked");
    expect(limits.error).toBe(endpoint);
  });
});

describe("fetchCodexRateLimits", () => {
  beforeEach(() => {
    child.live = 0;
    child.maxLive = 0;
    child.spawned = [];
  });

  it("runs usage probes for different accounts one at a time", async () => {
    const results = await Promise.all([
      fetchCodexRateLimits("default"),
      fetchCodexRateLimits("account-work"),
      fetchCodexRateLimits("account-personal"),
    ]);

    expect(child.maxLive).toBe(1);
    expect(child.spawned).toEqual([
      "default",
      "account-work",
      "account-personal",
    ]);
    expect(results.map((result) => result.session?.usedPercent)).toEqual([
      10, 10, 10,
    ]);
  });
});
