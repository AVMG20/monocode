import { useMemo, type ReactNode } from "react";
import type { GitBranches } from "../../../platform/tauri/fs";
import { prettyCwd } from "../../../shared/lib/paths";
import { Folder, FolderTree, Plus } from "../../../shared/ui/icons";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "../../../shared/ui/SearchableSelect";
import type { Worktrees } from "../../source-control/model/worktrees";
import {
  branchRef,
  branchValue,
  launchSwitchesBranch,
  parseBranchValue,
  pickerBranches,
  selectableWorktrees,
  type LaunchWorkspace,
} from "../model/launchWorkspace";

const KEEP_HEAD = "\u0000head";

const MODES = [
  ["current", "Current checkout", Folder],
  ["new", "New worktree", Plus],
  ["existing", "Existing worktree", FolderTree],
] as const;

/**
 * Workspace and branch for a session that has not started: run in the
 * project checkout on a chosen branch, in a new worktree, or in one that
 * already exists.
 */
export function LaunchWorkspacePicker({
  cwd,
  value,
  onChange,
  branches,
  worktrees,
  worktreesError,
  generatedName,
  disabled = false,
}: {
  cwd: string;
  value: LaunchWorkspace;
  onChange: (next: LaunchWorkspace) => void;
  branches: GitBranches | null;
  worktrees: Worktrees | undefined;
  worktreesError?: string;
  generatedName: string;
  disabled?: boolean;
}) {
  const headLabel = branches?.detached
    ? `Detached at ${(branches.current ?? "HEAD").slice(0, 7)}`
    : (branches?.current ?? "HEAD");

  const checkoutOptions = useMemo((): SearchableSelectOption[] => {
    const rows = pickerBranches(branches).map((branch) => ({
      value: branchValue(branch),
      label: branch.name,
      ...(branch.remote ? { detail: branch.remote, keywords: branchRef(branch) } : {}),
    }));
    return branches?.detached
      ? [{ value: KEEP_HEAD, label: headLabel }, ...rows]
      : rows;
  }, [branches, headLabel]);

  const baseOptions = useMemo((): SearchableSelectOption[] => {
    const seen = new Set<string>();
    const rows: SearchableSelectOption[] = [];
    for (const branch of branches?.branches ?? []) {
      const ref = branchRef(branch);
      if (seen.has(ref)) continue;
      seen.add(ref);
      rows.push({ value: ref, label: ref });
    }
    return branches?.detached
      ? [{ value: KEEP_HEAD, label: headLabel }, ...rows]
      : rows;
  }, [branches, headLabel]);

  const treeRows = useMemo(
    () => selectableWorktrees(worktrees?.worktrees ?? []),
    [worktrees],
  );
  const treeOptions = useMemo(
    (): SearchableSelectOption[] =>
      treeRows.map((tree) => ({
        value: tree.path,
        label: tree.branch ?? `Detached at ${tree.head.slice(0, 7)}`,
        detail: prettyCwd(tree.path),
        keywords: tree.path,
      })),
    [treeRows],
  );

  const currentValue =
    value.kind === "current" && value.branch && !value.branch.create
      ? branchValue(value.branch)
      : branches?.detached || !branches?.current
        ? KEEP_HEAD
        : branchValue({ name: branches.current, remote: null });

  const switching = launchSwitchesBranch(value, branches);
  const chosenTree =
    value.kind === "existing"
      ? treeRows.find((tree) => tree.path === value.path)
      : undefined;

  const setMode = (kind: LaunchWorkspace["kind"]) => {
    if (kind === value.kind) return;
    if (kind === "current") onChange({ kind, branch: null });
    else if (kind === "new") onChange({ kind, base: null, name: "" });
    else onChange({ kind, path: treeRows[0]?.path ?? "" });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] font-medium uppercase tracking-wide text-content/45">
        Workspace
      </div>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Workspace">
        {MODES.map(([kind, label, Icon]) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={value.kind === kind}
            disabled={disabled}
            onClick={() => setMode(kind)}
            className={`flex min-w-0 flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left text-[12px] ${
              value.kind === kind
                ? "border-content/30 bg-selection text-content"
                : "border-stroke text-content/70 hover:bg-content/5"
            } disabled:opacity-40`}
          >
            <Icon className="size-3.5 shrink-0 text-content/55" />
            <span className="w-full truncate">{label}</span>
          </button>
        ))}
      </div>

      {value.kind === "current" ? (
        <Field label="Branch">
          <SearchableSelect
            label="Branch"
            value={value.branch?.create ? "" : currentValue}
            placeholder={value.branch?.create ? `New branch ${value.branch.name}` : "Choose a branch…"}
            options={checkoutOptions}
            searchPlaceholder="Search or create a branch…"
            emptyLabel="No matching branches"
            disabled={disabled}
            onChange={(next) => {
              const parsed = next === KEEP_HEAD ? null : parseBranchValue(next);
              onChange({
                kind: "current",
                branch:
                  parsed &&
                  !(
                    !parsed.remote &&
                    !branches?.detached &&
                    parsed.name === branches?.current
                  )
                    ? parsed
                    : null,
              });
            }}
            create={{
              label: (name) => `Create branch ${name}`,
              onCreate: (name) =>
                onChange({
                  kind: "current",
                  branch: { name, remote: null, create: true },
                }),
            }}
          />
          {switching ? (
            <p className="text-[11px] leading-4 text-content/45">
              {value.branch?.create ? "Creates and checks out" : "Checks out"}{" "}
              {value.branch?.name} in {prettyCwd(cwd)}. Other sessions in this
              folder will see the switch.
            </p>
          ) : null}
        </Field>
      ) : null}

      {value.kind === "new" ? (
        <>
          <Field label="From">
            <SearchableSelect
              label="Base branch"
              value={
                value.base ??
                (branches?.detached || !branches?.current
                  ? KEEP_HEAD
                  : branches.current)
              }
              options={baseOptions}
              searchPlaceholder="Search base branches…"
              emptyLabel="No matching branches"
              disabled={disabled}
              onChange={(next) =>
                onChange({ ...value, base: next === KEEP_HEAD ? null : next })
              }
            />
          </Field>
          <Field label="New branch">
            <input
              value={value.name}
              placeholder={generatedName}
              aria-label="New branch name"
              spellCheck={false}
              autoComplete="off"
              disabled={disabled}
              onChange={(event) => onChange({ ...value, name: event.target.value })}
              className="flex h-9 w-full rounded-md border border-content/10 bg-background-base px-2.5 text-[13px] text-content outline-none placeholder:text-content/35 hover:border-content/20 focus:border-content/25 disabled:opacity-50"
            />
          </Field>
        </>
      ) : null}

      {value.kind === "existing" ? (
        <Field label="Worktree">
          {treeOptions.length > 0 ? (
            <SearchableSelect
              label="Worktree"
              value={value.path}
              options={treeOptions}
              placeholder="Choose a worktree…"
              searchPlaceholder="Search worktrees…"
              emptyLabel="No matching worktrees"
              disabled={disabled}
              onChange={(path) => onChange({ kind: "existing", path })}
            />
          ) : (
            <p className="text-[12px] text-content/45">
              {worktreesError
                ? worktreesError
                : worktrees
                  ? "This project has no other worktrees yet."
                  : "Loading worktrees…"}
            </p>
          )}
          {chosenTree?.dirty ? (
            <p className="text-[11px] leading-4 text-content/45">
              This worktree has uncommitted changes.
            </p>
          ) : null}
        </Field>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] text-content/45">{label}</div>
      {children}
    </div>
  );
}
