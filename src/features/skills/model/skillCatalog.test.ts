import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discoverPiSkills: vi.fn(),
  discoverOmpCommands: vi.fn(),
  subscribe: vi.fn(),
  listSkills: vi.fn(),
  readTextFile: vi.fn(),
}));

vi.mock("../../../integrations/harness/core/registry", () => ({
  getHarness: (id: string) =>
    id === "pi"
      ? {
          commands: {
            discover: ({ cwd }: { cwd: string }) => mocks.discoverPiSkills(cwd),
          },
        }
      : id === "omp"
        ? {
            commands: {
              discover: mocks.discoverOmpCommands,
              subscribe: mocks.subscribe,
              rawSlashCommands: true,
            },
          }
        : undefined,
}));

vi.mock("../../../platform/tauri/fs", () => ({
  createPath: vi.fn(),
  homeDir: vi.fn(),
  listSkills: mocks.listSkills,
  readTextFile: mocks.readTextFile,
  writeTextFile: vi.fn(),
}));

import {
  loadDisabledSkillPaths,
  saveDisabledSkillPaths,
  SKILLS_CHANGE_EVENT,
  BUILTIN_CREATE_SKILL,
  invalidateSkills,
  loadSkills,
  peekSkills,
  skillCatalogKey,
  subscribeSkills,
  applySkillsToTurn,
} from "./skills";
import type { DiscoveredSkill } from "../../../platform/tauri/fs";
import type { PiSkillCommand } from "../../../integrations/harness/providers/pi/piSkills";

function piSkill(name: string): PiSkillCommand {
  return {
    name,
    description: `${name} description`,
    invocation: `skill:${name}`,
    source: "pi",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-29T12:00:00Z"));
  invalidateSkills();
  mocks.discoverPiSkills.mockReset();
  mocks.discoverOmpCommands.mockReset();
  mocks.discoverOmpCommands.mockResolvedValue([
    {
      name: "workflow",
      invocation: "workflow",
      description: "",
      source: "omp",
    },
  ]);
  mocks.subscribe.mockReset();
  mocks.listSkills.mockReset();
  mocks.discoverPiSkills.mockResolvedValue([piSkill("architect")]);
  mocks.listSkills.mockResolvedValue([]);
});


describe("file skill visibility preferences", () => {
  const path = "/repo/.agents/skills/review/SKILL.md";
  let storage: Map<string, string>;

  beforeEach((): void => {
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string): string | null => storage.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        storage.set(key, value);
      },
    });
    vi.stubGlobal("window", new EventTarget());
    mocks.listSkills.mockResolvedValue([
      {
        name: "review",
        description: "Review changes",
        path,
        source: "agents",
        scope: "project",
      },
    ]);
  });
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it("removes a hidden file from a cached catalog and restores it", async (): Promise<void> => {
    const context = { harness: "claude", cwd: "/repo" } satisfies Parameters<
      typeof loadSkills
    >[0];
    expect(
      (await loadSkills(context)).some((skill) => skill.name === "review"),
    ).toBe(true);
    saveDisabledSkillPaths([path]);
    expect(await loadSkills(context)).toEqual([BUILTIN_CREATE_SKILL]);
    saveDisabledSkillPaths([]);
    expect(
      (await loadSkills(context)).some((skill) => skill.name === "review"),
    ).toBe(true);
  });

  it("does not inject hidden skill content into a submitted turn", async (): Promise<void> => {
    saveDisabledSkillPaths([path]);
    const result = await applySkillsToTurn("/review inspect this", {
      harness: "claude",
      cwd: "/repo",
    });
    expect(result).toBe("/review inspect this");
  });


  it("notifies open views only after persistence succeeds", (): void => {
    const listener = vi.fn();
    window.addEventListener(SKILLS_CHANGE_EVENT, listener);
    saveDisabledSkillPaths([path]);
    expect(loadDisabledSkillPaths()).toEqual([path]);
    expect(listener).toHaveBeenCalledTimes(1);
    vi.stubGlobal("localStorage", {
      setItem: (): never => {
        throw new Error("quota");
      },
    });
    expect(() => saveDisabledSkillPaths([])).toThrow(
      "Could not save skill preferences",
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("tolerates malformed and mixed stored preferences", (): void => {
    storage.set("monocode.disabledSkillPaths", "invalid json");
    expect(loadDisabledSkillPaths()).toEqual([]);
    storage.set(
      "monocode.disabledSkillPaths",
      JSON.stringify([path, null, 42]),
    );
    expect(loadDisabledSkillPaths()).toEqual([path]);
  });

  it("does not restore an old catalog when a scan finishes after hiding a skill", async (): Promise<void> => {
    const projectPath = "/repo/.agents/skills/review/SKILL.md";
    const personalPath = "/home/user/.agents/skills/review/SKILL.md";
    const projectSkill: DiscoveredSkill = {
      name: "review",
      description: "Project review",
      path: projectPath,
      source: "agents",
      scope: "project",
    };
    const personalSkill: DiscoveredSkill = {
      name: "review",
      description: "Personal review",
      path: personalPath,
      source: "agents",
      scope: "user",
    };

    const pending = deferred<DiscoveredSkill[]>();
    mocks.listSkills.mockReturnValueOnce(pending.promise);
    const context = { harness: "claude", cwd: "/repo" } satisfies Parameters<
      typeof loadSkills
    >[0];

    // 1. Start discovery while project skill is enabled
    const oldScan = loadSkills(context);

    // 2. Disable the project winner during the scan
    saveDisabledSkillPaths([projectPath]);

    // 3. Complete a fresh scan that selects the personal file fallback
    mocks.listSkills.mockResolvedValueOnce([personalSkill]);
    await loadSkills(context);
    expect(peekSkills(context)?.find((s) => s.name === "review")).toMatchObject({
      name: "review",
      path: personalPath,
      scope: "user",
    });

    // 4. Resolve older scan with the obsolete project candidate
    pending.resolve([projectSkill]);
    await oldScan;

    // Assert that the personal fallback remains active
    expect(peekSkills(context)?.find((s) => s.name === "review")).toMatchObject({
      name: "review",
      path: personalPath,
      scope: "user",
    });

    // 5. Cover re-enabling during a scan:
    const reEnablePending = deferred<DiscoveredSkill[]>();
    mocks.listSkills.mockReturnValueOnce(reEnablePending.promise);
    const inFlightPersonalScan = loadSkills(context, { refresh: true });

    // Re-enable project winner during the scan
    saveDisabledSkillPaths([]);

    // Complete fresh scan returning restored project winner
    mocks.listSkills.mockResolvedValueOnce([projectSkill]);
    await loadSkills(context);
    expect(peekSkills(context)?.find((s) => s.name === "review")).toMatchObject({
      name: "review",
      path: projectPath,
      scope: "project",
    });

    // Resolve the in-flight older scan
    reEnablePending.resolve([personalSkill]);
    await inFlightPersonalScan;

    // Assert that project winner remains active
    expect(peekSkills(context)?.find((s) => s.name === "review")).toMatchObject({
      name: "review",
      path: projectPath,
      scope: "project",
    });
  });

  it("falls back to same-name personal skill when project skill is disabled, and injects its content", async (): Promise<void> => {
    const projectSkillPath = "/repo/.agents/skills/review/SKILL.md";
    const personalSkillPath = "/home/user/.agents/skills/review/SKILL.md";
    const context = { harness: "claude", cwd: "/repo" } satisfies Parameters<
      typeof loadSkills
    >[0];

    mocks.listSkills.mockImplementation(
      async (_cwd: string, disabled?: readonly string[] | null) => {
        const disabledSet = new Set(disabled ?? []);
        if (!disabledSet.has(projectSkillPath)) {
          return [
            {
              name: "review",
              description: "Project review",
              path: projectSkillPath,
              source: "agents",
              scope: "project",
            },
          ];
        }
        if (!disabledSet.has(personalSkillPath)) {
          return [
            {
              name: "review",
              description: "Personal review",
              path: personalSkillPath,
              source: "agents",
              scope: "user",
            },
          ];
        }
        return [];
      },
    );

    mocks.readTextFile.mockImplementation(async (targetPath: string) => {
      if (targetPath === projectSkillPath) return "Project review instructions";
      if (targetPath === personalSkillPath) return "Personal review instructions";
      return "";
    });

    // 1. With neither disabled, project file wins
    const initialSkills = await loadSkills(context);
    const initialReview = initialSkills.find((s) => s.name === "review");
    expect(initialReview).toMatchObject({
      name: "review",
      path: projectSkillPath,
      scope: "project",
    });
    const initialTurn = await applySkillsToTurn("/review inspect this", context);
    expect(initialTurn).toContain("Project review instructions");

    // 2. Disabling only the project file makes the personal file the active result
    saveDisabledSkillPaths([projectSkillPath]);
    const fallbackSkills = await loadSkills(context);
    const fallbackReview = fallbackSkills.find((s) => s.name === "review");
    expect(fallbackReview).toMatchObject({
      name: "review",
      path: personalSkillPath,
      scope: "user",
    });
    const fallbackTurn = await applySkillsToTurn("/review inspect this", context);
    expect(fallbackTurn).toContain("Personal review instructions");
    expect(fallbackTurn).not.toContain("Project review instructions");

    // 3. Re-enabling the project file restores it as the winner
    saveDisabledSkillPaths([]);
    const restoredSkills = await loadSkills(context);
    const restoredReview = restoredSkills.find((s) => s.name === "review");
    expect(restoredReview).toMatchObject({
      name: "review",
      path: projectSkillPath,
      scope: "project",
    });
    const restoredTurn = await applySkillsToTurn("/review inspect this", context);
    expect(restoredTurn).toContain("Project review instructions");

    // 4. Disabling lower-priority candidate does not affect enabled winner
    saveDisabledSkillPaths([personalSkillPath]);
    const winnerSkills = await loadSkills(context);
    const winnerReview = winnerSkills.find((s) => s.name === "review");
    expect(winnerReview).toMatchObject({
      name: "review",
      path: projectSkillPath,
      scope: "project",
    });

    // 5. Disabling both files removes that file skill from the active catalog
    saveDisabledSkillPaths([projectSkillPath, personalSkillPath]);
    const disabledSkills = await loadSkills(context);
    expect(disabledSkills.find((s) => s.name === "review")).toBeUndefined();
    const disabledTurn = await applySkillsToTurn("/review inspect this", context);
    expect(disabledTurn).toBe("/review inspect this");
  });
});
