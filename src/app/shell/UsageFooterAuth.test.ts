// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  loginHarness: vi.fn<(_harness: string) => Promise<void>>(),
}));
const rateLimitsFetch = vi.hoisted(() => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  fetchClaudeRateLimits: vi.fn(),
  fetchCodexRateLimits: vi.fn(),
}));

vi.mock("../../integrations/harness/core/auth", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../integrations/harness/core/auth")
  >()),
  loginHarness: auth.loginHarness,
}));
vi.mock(
  "../../features/providers/model/rateLimitsFetch",
  () => rateLimitsFetch,
);

import type {
  ProviderRateLimits,
  RateLimitProvider,
} from "../../features/providers/model/rateLimits";
import { clearCachedRateLimits } from "../../features/providers/model/rateLimitsCache";
import { UsageFooter } from "./UsageFooter";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  auth.loginHarness.mockReset();
  rateLimitsFetch.consumeCodexRateLimitResetCredit.mockReset();
  rateLimitsFetch.fetchClaudeRateLimits.mockReset();
  rateLimitsFetch.fetchCodexRateLimits.mockReset();
  clearCachedRateLimits();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const result = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent) === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}

function signedOutLimits(provider: RateLimitProvider): ProviderRateLimits {
  return {
    provider,
    session: null,
    weekly: null,
    monthly: null,
    resetCredits: null,
    updatedAt: Date.now(),
    error: `${provider} is not signed in`,
    status: "error",
  };
}

function connectedLimits(provider: RateLimitProvider): ProviderRateLimits {
  return {
    ...signedOutLimits(provider),
    error: null,
    status: "ok",
  };
}

describe("UsageFooter provider authentication", () => {
  it("shows the last Claude usage snapshot after a 503 refresh", async () => {
    rateLimitsFetch.fetchClaudeRateLimits
      .mockResolvedValueOnce({
        ...connectedLimits("claude"),
        session: {
          usedPercent: 94,
          windowMinutes: 300,
          resetsAt: Date.now() + 60_000,
        },
      })
      .mockResolvedValueOnce({
        ...signedOutLimits("claude"),
        error: "Claude usage request failed (503)",
      });

    await act(async () =>
      root.render(createElement(UsageFooter, { providers: ["claude"] })),
    );
    await act(async () => button("Refresh usage").click());
    await act(async () => button("Claude Code usage details").click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("94%");
    expect(dialog?.textContent).toContain("Showing the last available snapshot");
    expect(dialog?.textContent).toContain("503");
  });

  it("makes one final poll after a Codex turn finishes, then stops", async () => {
    vi.useFakeTimers();
    try {
      rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(
        connectedLimits("codex"),
      );
      const session = { id: "active", harness: "codex" as const, busy: true };
      await act(async () =>
        root.render(createElement(UsageFooter, { providers: ["codex"], session })),
      );
      expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(1);

      await act(async () => vi.advanceTimersByTimeAsync(2 * 60_000));

      await act(async () =>
        root.render(createElement(UsageFooter, {
          providers: ["codex"],
          session: { ...session, busy: false },
        })),
      );
      expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(1);

      await act(async () => vi.advanceTimersByTimeAsync(3 * 60_000));
      expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(2);

      await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
      expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls only the active session when switching between running sessions", async () => {
    vi.useFakeTimers();
    try {
      rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(
        connectedLimits("codex"),
      );
      await act(async () =>
        root.render(createElement(UsageFooter, {
          providers: ["codex"],
          session: { id: "first", harness: "codex", busy: true },
        })),
      );
      await act(async () => vi.advanceTimersByTimeAsync(2 * 60_000));
      await act(async () =>
        root.render(createElement(UsageFooter, {
          providers: ["codex"],
          session: { id: "second", harness: "codex", busy: true },
        })),
      );

      await act(async () => vi.advanceTimersByTimeAsync(3 * 60_000));
      expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(1);

      await act(async () => vi.advanceTimersByTimeAsync(2 * 60_000));
      expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses usage on remount and only fetches again on Refresh", async () => {
    rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(
      connectedLimits("codex"),
    );
    await act(async () =>
      root.render(createElement(UsageFooter, { providers: ["codex"] })),
    );
    expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () =>
      root.render(createElement(UsageFooter, { providers: ["codex"] })),
    );
    document.dispatchEvent(new Event("visibilitychange"));
    expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(1);

    await act(async () => button("Refresh usage").click());
    expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(2);
  });

  it("keeps a healthy Grok provider label non-interactive", () => {
    act(() =>
      root.render(
        createElement(UsageFooter, {
          providers: [],
          session: {
            id: "grok-session",
            harness: "grok",
            authRequired: false,
          },
        }),
      ),
    );

    expect(container.textContent).toContain("grok");
    expect(container.textContent).not.toContain("sign in");
    expect(container.querySelector("button")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens Grok sign-in from its footer provider popover", async () => {
    let finishLogin: (() => void) | undefined;
    auth.loginHarness.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLogin = resolve;
        }),
    );
    act(() =>
      root.render(
        createElement(UsageFooter, {
          providers: [],
          session: {
            id: "grok-session",
            harness: "grok",
            authRequired: true,
          },
        }),
      ),
    );

    expect(container.textContent).toContain("grok");
    expect(container.textContent).toContain("sign in");
    act(() => button("Grok Build sign-in required").click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Authentication required");
    expect(dialog?.querySelector(".size-9")).not.toBeNull();

    act(() => button("Sign in to Grok Build").click());
    expect(auth.loginHarness).toHaveBeenCalledWith("grok");
    expect(dialog?.textContent).toContain("Waiting for browser…");

    await act(async () => finishLogin?.());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain("sign in");
  });

  it("starts a waiting recovery after another provider login fails", async () => {
    let rejectClaude: ((error: Error) => void) | undefined;
    auth.loginHarness.mockImplementation((harness) => {
      if (harness === "claude") {
        return new Promise<void>((_resolve, reject) => {
          rejectClaude = reject;
        });
      }
      return Promise.resolve();
    });
    rateLimitsFetch.fetchClaudeRateLimits.mockResolvedValue(
      signedOutLimits("claude"),
    );
    rateLimitsFetch.fetchCodexRateLimits
      .mockResolvedValueOnce(signedOutLimits("codex"))
      .mockResolvedValueOnce(connectedLimits("codex"));

    await act(async () => {
      root.render(
        createElement(UsageFooter, {
          providers: ["claude", "codex"],
        }),
      );
    });

    act(() => button("Claude Code usage details").click());
    act(() => button("Sign in to Claude Code").click());
    await vi.waitFor(() =>
      expect(auth.loginHarness).toHaveBeenCalledWith("claude"),
    );

    act(() => button("Codex usage details").click());
    act(() => button("Sign in to Codex").click());
    expect(auth.loginHarness).not.toHaveBeenCalledWith("codex");

    await act(async () => rejectClaude?.(new Error("Claude login failed")));
    await vi.waitFor(() =>
      expect(auth.loginHarness).toHaveBeenCalledWith("codex"),
    );
  });
});
