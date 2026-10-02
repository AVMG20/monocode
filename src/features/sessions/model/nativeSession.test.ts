import { describe, expect, it } from "vitest";
import { isNativeProvider, nativeTitleFromTerminal } from "./nativeSession";

describe("nativeTitleFromTerminal", () => {
  it("names a placeholder session from Claude's terminal title", () => {
    expect(
      nativeTitleFromTerminal("✳ Fix login bug", {
        id: "a",
        title: "claude",
        harness: "claude",
      }),
    ).toBe("claude · Fix login bug");
  });

  it("ignores generic titles and paths", () => {
    const session = { id: "b", title: "claude", harness: "claude" as const };
    expect(nativeTitleFromTerminal("✳ Claude Code", session)).toBeNull();
    expect(nativeTitleFromTerminal("~/code/app", session)).toBeNull();
    expect(nativeTitleFromTerminal("  ", session)).toBeNull();
  });

  it("keeps a title the user chose", () => {
    expect(
      nativeTitleFromTerminal("✳ Refactor", {
        id: "c",
        title: "claude · My name",
        harness: "claude",
      }),
    ).toBeNull();
  });

  it("follows later titles it set itself", () => {
    const first = nativeTitleFromTerminal("✳ First topic", {
      id: "d",
      title: "claude",
      harness: "claude",
    });
    expect(first).toBe("claude · First topic");
    expect(
      nativeTitleFromTerminal("⠂ Second topic", {
        id: "d",
        title: first!,
        harness: "claude",
      }),
    ).toBe("claude · Second topic");
  });
});

describe("isNativeProvider", () => {
  it("accepts only providers with a hosted CLI", () => {
    expect(isNativeProvider("claude")).toBe(true);
    expect(isNativeProvider("antigravity")).toBe(true);
    expect(isNativeProvider("cursor")).toBe(false);
  });
});
