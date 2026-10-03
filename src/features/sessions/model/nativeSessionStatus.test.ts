import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../platform/tauri/nativeSession", () => ({
  subscribeNativeSessionStatus: () => () => undefined,
}));

import {
  nativeWaitingIds,
  nativeStatusesSnapshot,
  setNativeSessionStatus,
  watchNativeTurn,
} from "./nativeSessionStatus";

beforeEach(() => {
  vi.useFakeTimers();
  for (const id of nativeStatusesSnapshot().keys())
    setNativeSessionStatus(id, null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("watchNativeTurn", () => {
  it("completes when a hooked CLI goes from running back to idle", () => {
    const settle = vi.fn();
    watchNativeTurn("a", settle, { hooks: true });
    setNativeSessionStatus("a", "idle");
    expect(settle).not.toHaveBeenCalled();
    setNativeSessionStatus("a", "running");
    setNativeSessionStatus("a", "waiting");
    expect(settle).not.toHaveBeenCalled();
    setNativeSessionStatus("a", "idle");
    expect(settle).toHaveBeenCalledWith("completed");
  });

  it("does not guess completion for a hooked CLI that is slow to start", () => {
    const settle = vi.fn();
    watchNativeTurn("b", settle, { hooks: true });
    vi.advanceTimersByTime(60_000);
    expect(settle).not.toHaveBeenCalled();
  });

  it("assumes completion after the fallback for CLIs without hooks", () => {
    const settle = vi.fn();
    watchNativeTurn("c", settle, { fallbackMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(settle).toHaveBeenCalledWith("completed");
  });

  it("waits for a turn already in progress before tracking its own", () => {
    setNativeSessionStatus("d", "running");
    const settle = vi.fn();
    watchNativeTurn("d", settle, { hooks: true });
    setNativeSessionStatus("d", "idle");
    expect(settle).not.toHaveBeenCalled();
    setNativeSessionStatus("d", "running");
    setNativeSessionStatus("d", "idle");
    expect(settle).toHaveBeenCalledWith("completed");
  });

  it("fails when the CLI exits mid-turn or never settles", () => {
    const exited = vi.fn();
    watchNativeTurn("e", exited, { hooks: true });
    setNativeSessionStatus("e", "running");
    setNativeSessionStatus("e", null);
    expect(exited).toHaveBeenCalledWith("failed");

    const stuck = vi.fn();
    watchNativeTurn("f", stuck, { hooks: true, maxMs: 5000 });
    setNativeSessionStatus("f", "running");
    vi.advanceTimersByTime(5000);
    expect(stuck).toHaveBeenCalledWith("failed");
  });
});

it("lists sessions waiting on the user", () => {
  setNativeSessionStatus("g", "waiting");
  setNativeSessionStatus("h", "running");
  expect([...nativeWaitingIds()]).toEqual(["g"]);
});
