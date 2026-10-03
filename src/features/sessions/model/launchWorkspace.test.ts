import { describe, expect, it, vi } from "vitest";
import type { GitBranches } from "../../../platform/tauri/fs";
import type { Worktree } from "../../source-control/model/worktrees";
import {
  branchValue,
  defaultLaunchWorkspace,
  isGitRepo,
  launchSwitchesBranch,
  parseBranchValue,
  pickerBranches,
  prepareLaunchWorkspace,
  selectableWorktrees,
  type LaunchGit,
} from "./launchWorkspace";

const branches: GitBranches = {
  current: "main",
  detached: false,
  branches: [
    { name: "main", current: true, remote: null },
    { name: "feature", current: false, remote: null },
    { name: "main", current: false, remote: "origin" },
    { name: "remote-only", current: false, remote: "origin" },
  ],
};

function tree(patch: Partial<Worktree>): Worktree {
  return {
    path: "/repo",
    branch: "main",
    head: "abcdef1234",
    isMain: false,
    locked: false,
    prunable: false,
    missing: false,
    dirty: false,
    unpushed: 0,
    sessionIds: [],
    ...patch,
  };
}

function git(): LaunchGit & {
  checkout: ReturnType<typeof vi.fn>;
  createBranch: ReturnType<typeof vi.fn>;
  createWorktree: ReturnType<typeof vi.fn>;
} {
  return {
    checkout: vi.fn(async (_cwd: string, name: string) => name),
    createBranch: vi.fn(async (_cwd: string, name: string) => name),
    createWorktree: vi.fn(async (_cwd: string, branch: string) =>
      tree({ path: `/trees/${branch}`, branch }),
    ),
  };
}

describe("launch workspace", () => {
  it("defaults to the session's worktree, else the project checkout", () => {
    expect(defaultLaunchWorkspace({ cwd: "/repo" })).toEqual({
      kind: "current",
      branch: null,
    });
    expect(
      defaultLaunchWorkspace({ cwd: "/repo", worktreeCwd: "/trees/a" }),
    ).toEqual({ kind: "existing", path: "/trees/a" });
  });

  it("starts an automation's requested worktree from its base", () => {
    expect(
      defaultLaunchWorkspace({
        cwd: "/repo",
        workspaceMode: "worktree",
        worktreeBase: "develop",
      }),
    ).toEqual({ kind: "new", base: "develop", name: "" });
    expect(
      defaultLaunchWorkspace({ cwd: "/repo", workspaceMode: "worktree", worktreeBase: "HEAD" }),
    ).toEqual({ kind: "new", base: null, name: "" });
  });

  it("tells a repository from a plain folder's empty listing", () => {
    expect(isGitRepo(null)).toBe(false);
    expect(isGitRepo({ current: null, detached: false, branches: [] })).toBe(false);
    expect(isGitRepo(branches)).toBe(true);
    expect(isGitRepo({ current: "abc1234", detached: true, branches: [] })).toBe(true);
  });

  it("round-trips branch values, including remotes with slashes", () => {
    const value = branchValue({ name: "fix/a", remote: "up/stream" });
    expect(parseBranchValue(value)).toEqual({ name: "fix/a", remote: "up/stream" });
    expect(parseBranchValue("main")).toBeNull();
    expect(parseBranchValue('["a"]')).toBeNull();
  });

  it("hides remote copies of local branches", () => {
    expect(pickerBranches(branches).map((b) => `${b.remote ?? ""}:${b.name}`)).toEqual([
      ":main",
      ":feature",
      "origin:remote-only",
    ]);
  });

  it("offers only usable linked worktrees", () => {
    const rows = selectableWorktrees([
      tree({ path: "/repo", isMain: true }),
      tree({ path: "/a" }),
      tree({ path: "/b", missing: true }),
      tree({ path: "/c", prunable: true }),
    ]);
    expect(rows.map((row) => row.path)).toEqual(["/a"]);
  });

  it("keeps the checked-out branch without touching Git", async () => {
    const ops = git();
    const placement = await prepareLaunchWorkspace(
      "/repo",
      { kind: "current", branch: null },
      branches,
      [],
      "mc/x",
      ops,
    );
    expect(placement).toEqual({ worktreeCwd: undefined, branch: "main" });
    expect(ops.checkout).not.toHaveBeenCalled();
  });

  it("does not check out the branch that is already current", async () => {
    const ops = git();
    const workspace = {
      kind: "current" as const,
      branch: { name: "main", remote: null },
    };
    expect(launchSwitchesBranch(workspace, branches)).toBe(false);
    await prepareLaunchWorkspace("/repo", workspace, branches, [], "mc/x", ops);
    expect(ops.checkout).not.toHaveBeenCalled();
  });

  it("checks out or creates the chosen branch", async () => {
    const ops = git();
    expect(
      await prepareLaunchWorkspace(
        "/repo",
        { kind: "current", branch: { name: "remote-only", remote: "origin" } },
        branches,
        [],
        "mc/x",
        ops,
      ),
    ).toEqual({ worktreeCwd: undefined, branch: "remote-only" });
    expect(ops.checkout).toHaveBeenCalledWith("/repo", "remote-only", "origin");

    await prepareLaunchWorkspace(
      "/repo",
      { kind: "current", branch: { name: "new-thing", remote: null, create: true } },
      branches,
      [],
      "mc/x",
      ops,
    );
    expect(ops.createBranch).toHaveBeenCalledWith("/repo", "new-thing");
  });

  it("surfaces Git's error when the checkout fails", async () => {
    const ops = git();
    ops.checkout.mockRejectedValueOnce(new Error("would be overwritten"));
    await expect(
      prepareLaunchWorkspace(
        "/repo",
        { kind: "current", branch: { name: "feature", remote: null } },
        branches,
        [],
        "mc/x",
        ops,
      ),
    ).rejects.toThrow("would be overwritten");
  });

  it("creates a new worktree from the current branch by default", async () => {
    const ops = git();
    const placement = await prepareLaunchWorkspace(
      "/repo",
      { kind: "new", base: null, name: "  " },
      branches,
      [],
      "mc/abc",
      ops,
    );
    expect(ops.createWorktree).toHaveBeenCalledWith("/repo", "mc/abc", "main");
    expect(placement).toEqual({ worktreeCwd: "/trees/mc/abc", branch: "mc/abc" });
  });

  it("creates a named worktree from a chosen base, or HEAD when detached", async () => {
    const ops = git();
    await prepareLaunchWorkspace(
      "/repo",
      { kind: "new", base: "origin/main", name: "fix-login" },
      branches,
      [],
      "mc/abc",
      ops,
    );
    expect(ops.createWorktree).toHaveBeenCalledWith("/repo", "fix-login", "origin/main");

    await prepareLaunchWorkspace(
      "/repo",
      { kind: "new", base: null, name: "" },
      { ...branches, detached: true, current: "abcdef1" },
      [],
      "mc/abc",
      ops,
    );
    expect(ops.createWorktree).toHaveBeenLastCalledWith("/repo", "mc/abc", "HEAD");
  });

  it("joins an existing worktree with its branch", async () => {
    const ops = git();
    expect(
      await prepareLaunchWorkspace(
        "/repo",
        { kind: "existing", path: "/trees/a" },
        branches,
        [tree({ path: "/trees/a", branch: "feature" })],
        "mc/x",
        ops,
      ),
    ).toEqual({ worktreeCwd: "/trees/a", branch: "feature" });
    expect(
      await prepareLaunchWorkspace(
        "/repo",
        { kind: "existing", path: "/trees/gone" },
        branches,
        [],
        "mc/x",
        ops,
      ),
    ).toEqual({ worktreeCwd: "/trees/gone", branch: undefined });
    expect(ops.createWorktree).not.toHaveBeenCalled();
  });
});
