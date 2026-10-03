vi.mock("../../../integrations/harness/core/registry", () => ({
  getHarness: (id: string) =>
    id === "pi" || id === "omp"
      ? {
          commands: {
            discover: async () => [],
            rawSlashCommands: id === "omp",
          },
        }
      : undefined,
}));

import { describe, expect, it, vi } from "vitest";
import { nativeSkillContextForSession } from "./sessionSkills";

describe("nativeSkillContextForSession", () => {

  it("ignores a non-Pi session", () => {
    expect(
      nativeSkillContextForSession({ harness: "claude", cwd: "/repo" }),
    ).toBeNull();
  });
});
