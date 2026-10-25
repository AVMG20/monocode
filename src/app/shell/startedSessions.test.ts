import { describe, expect, it } from "vitest";
import { startedSessionCaller } from "./Sidebar";

describe("startedSessionCaller", () => {
  it("finds a launch's caller only among the given sessions", () => {
    const ids = new Set(["ab3c-98dc", "plain"]);
    expect(startedSessionCaller("app-ab3c-98dc-3a64-6702", ids)).toBe(
      "ab3c-98dc",
    );
    expect(startedSessionCaller("app-mono-1-task", ids)).toBeUndefined();
    expect(startedSessionCaller("plain", ids)).toBeUndefined();
  });
});
