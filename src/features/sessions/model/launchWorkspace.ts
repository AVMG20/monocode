import type { GitBranchInfo, GitBranches } from "../../../platform/tauri/fs";
import type { Worktree } from "../../source-control/model/worktrees";

/**
 * Where a new native session runs, picked before its CLI starts:
 * the project checkout (optionally on another branch), a new worktree,
 * or a worktree that already exists.
 */
export type LaunchWorkspace =
  | {
      kind: "current";
      /** Branch to check out first; null keeps whatever is checked out. */
      branch: { name: string; remote: string | null; create?: boolean } | null;
    }
  | {
      kind: "new";
      /** Ref the new branch starts from; null means the checked-out branch. */
      base: string | null;
      /** Branch name for the worktree; blank picks a generated one. */
      name: string;
    }
  | { kind: "existing"; path: string };

export type LaunchPlacement = { worktreeCwd?: string; branch?: string };

export type LaunchGit = {
  /** Both resolve to the branch name Git ended up on. */
  checkout: (cwd: string, name: string, remote: string | null) => Promise<string>;
  createBranch: (cwd: string, name: string) => Promise<string>;
  createWorktree: (cwd: string, branch: string, base: string) => Promise<Worktree>;
};

export function defaultLaunchWorkspace(session: {
  cwd: string;
  worktreeCwd?: string;
}): LaunchWorkspace {
  return session.worktreeCwd
    ? { kind: "existing", path: session.worktreeCwd }
    : { kind: "current", branch: null };
}

/** Git-facing ref of a listed branch: `origin/main` or `main`. */
export function branchRef(branch: Pick<GitBranchInfo, "name" | "remote">): string {
  return branch.remote ? `${branch.remote}/${branch.name}` : branch.name;
}

/** Stable option value for a branch row; remote names may contain slashes. */
export function branchValue(branch: Pick<GitBranchInfo, "name" | "remote">): string {
  return JSON.stringify([branch.remote, branch.name]);
}

export function parseBranchValue(
  value: string,
): { name: string; remote: string | null } | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      (parsed[0] === null || typeof parsed[0] === "string") &&
      typeof parsed[1] === "string"
    ) {
      return { remote: parsed[0], name: parsed[1] };
    }
  } catch {
    // Not a branch row.
  }
  return null;
}

/** Branch rows for a picker: a remote copy of a local branch adds nothing. */
export function pickerBranches(branches: GitBranches | null): GitBranchInfo[] {
  const rows = branches?.branches ?? [];
  const local = new Set(rows.filter((row) => !row.remote).map((row) => row.name));
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (row.remote && local.has(row.name)) return false;
    const key = branchValue(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Working copies a session can join: never the main checkout or a stale entry. */
export function selectableWorktrees(trees: readonly Worktree[]): Worktree[] {
  return trees.filter((tree) => !tree.isMain && !tree.missing && !tree.prunable);
}

/** The branch a "current checkout" launch would end up on. */
export function launchBranchName(
  workspace: LaunchWorkspace,
  branches: GitBranches | null,
): string | null {
  if (workspace.kind !== "current") return null;
  if (workspace.branch) return workspace.branch.name;
  return branches && !branches.detached ? branches.current : null;
}

/** Whether starting would switch the project checkout to another branch. */
export function launchSwitchesBranch(
  workspace: LaunchWorkspace,
  branches: GitBranches | null,
): boolean {
  if (workspace.kind !== "current" || !workspace.branch) return false;
  const { name, remote, create } = workspace.branch;
  if (create || remote) return true;
  return !branches || branches.detached || branches.current !== name;
}

/**
 * Do the Git work a launch needs and say where the session runs. Throws
 * Git's message when the checkout or worktree cannot be made.
 */
export async function prepareLaunchWorkspace(
  cwd: string,
  workspace: LaunchWorkspace,
  branches: GitBranches | null,
  worktrees: readonly Worktree[],
  generatedName: string,
  git: LaunchGit,
): Promise<LaunchPlacement> {
  if (workspace.kind === "existing") {
    const tree = worktrees.find((entry) => entry.path === workspace.path);
    if (!tree) {
      // Kept from an earlier launch: the list may simply not have loaded.
      return { worktreeCwd: workspace.path, branch: undefined };
    }
    return { worktreeCwd: tree.path, branch: tree.branch ?? undefined };
  }
  if (workspace.kind === "new") {
    const base =
      workspace.base ||
      (branches && !branches.detached ? branches.current : null) ||
      "HEAD";
    const tree = await git.createWorktree(
      cwd,
      workspace.name.trim() || generatedName,
      base,
    );
    return { worktreeCwd: tree.path, branch: tree.branch ?? undefined };
  }
  const target = workspace.branch;
  if (target && launchSwitchesBranch(workspace, branches)) {
    const branch = target.create
      ? await git.createBranch(cwd, target.name)
      : await git.checkout(cwd, target.name, target.remote);
    return { worktreeCwd: undefined, branch: branch || target.name };
  }
  const branch = launchBranchName(workspace, branches);
  return { worktreeCwd: undefined, branch: branch ?? undefined };
}
