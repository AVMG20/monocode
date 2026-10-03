import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  listNativeProviders,
  type NativeProviderId,
} from "../../../platform/tauri/nativeSession";
import {
  providerAccountLabel,
  providerAccounts,
  selectProviderAccount,
  selectedProviderAccountId,
  subscribeProviderAccounts,
  supportsProviderAccounts,
  DEFAULT_PROVIDER_ACCOUNT_ID,
} from "../../providers/model/providerAccounts";
import {
  HARNESS_TITLE,
  sessionWorkCwd,
  type HarnessId,
  type Session,
} from "../model/session";
import {
  NATIVE_PROVIDERS,
  isNativeProvider,
  nativeTitleFromTerminal,
  type NativeSessionPatch,
} from "../model/nativeSession";
import { HarnessIcon } from "./HarnessIcon";
import {
  isPickerProviderVisible,
  preferredModelId,
  saveLastModelChoice,
} from "../model/models";
import { loadProjectProviderSettings } from "../model/projectProviders";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { FolderTree, GitBranch, Terminal } from "../../../shared/ui/icons";
import {
  gitBranches,
  gitCheckout,
  gitCreateBranch,
  isCheckoutBlockedByChanges,
  notifyGitChanged,
} from "../../../platform/tauri/fs";
import {
  seedProjectBranches,
  useProjectBranchesState,
} from "../../source-control/hooks/useProjectBranches";
import { useProjectWorktrees } from "../../source-control/hooks/useProjectWorktrees";
import {
  createWorktree,
  temporaryWorktreeBranchName,
} from "../../source-control/model/worktrees";
import {
  defaultLaunchWorkspace,
  isGitRepo,
  launchSwitchesBranch,
  prepareLaunchWorkspace,
  selectableWorktrees,
  type LaunchWorkspace,
} from "../model/launchWorkspace";
import { LaunchWorkspacePicker } from "./LaunchWorkspacePicker";

import {
  attachNativeTerminal,
  disposeNativeTerminal,
  focusNativeTerminal,
  markFreshNativeLaunch,
  type NativeTerminalState,
} from "./nativeTerminals";

type Props = {
  session: Session;
  visible: boolean;
  focused: boolean;
  onFocus: (sessionId: string) => void;
  onPatch: (sessionId: string, patch: NativeSessionPatch) => void;
  /** Open an extra shell terminal below this session. */
  onNewTerminal?: (sessionId: string) => void;
  /** Present in a split: dragging the header moves the pane. */
  onPaneDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
};

/**
 * A session tab: the provider's own interactive CLI (`claude`, `codex`, ...)
 * running in a terminal. Before the first launch it shows a small picker for
 * provider and account profile.
 */
export function NativeSessionPane({
  session,
  visible,
  focused,
  onFocus,
  onPatch,
  onNewTerminal,
  onPaneDragStart,
}: Props) {
  const launched =
    !!session.providerSessionId && isNativeProvider(session.harness);
  if (session.worktreeRemoved) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-content/50">
        This session's worktree was removed, so its agent has no folder to run
        in.
      </div>
    );
  }
  if (isRemoteProjectPath(session.cwd)) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-content/50">
        Agent sessions run in a terminal on this computer, so they can't open
        in a remote project yet.
      </div>
    );
  }
  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-col"
      onMouseDown={() => onFocus(session.id)}
    >
      {launched ? (
        <NativeSessionHeader
          session={session}
          onPatch={onPatch}
          onNewTerminal={onNewTerminal}
          onPaneDragStart={onPaneDragStart}
        />
      ) : null}
      {launched ? (
        <NativeTerminalSurface
          session={session}
          visible={visible}
          focused={focused}
          onPatch={onPatch}
        />
      ) : (
        <NativeSessionLauncher session={session} onPatch={onPatch} />
      )}
    </div>
  );
}

function NativeSessionHeader({
  session,
  onPatch,
  onNewTerminal,
  onPaneDragStart,
}: {
  session: Session;
  onPatch: Props["onPatch"];
  onNewTerminal?: (sessionId: string) => void;
  onPaneDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const profileLabel = useSyncExternalStore(
    subscribeProviderAccounts,
    () =>
      supportsProviderAccounts(session.harness)
        ? providerAccountLabel(session.harness, session.providerAccountId)
        : "",
    () => "",
  );
  const multipleProfiles =
    supportsProviderAccounts(session.harness) &&
    providerAccounts(session.harness).length > 1;
  // The branch the CLI is on right now; the sidebar shows the saved copy.
  const workCwd = sessionWorkCwd(session);
  const { branches } = useProjectBranchesState(workCwd, true);
  const repo = isGitRepo(branches);
  const liveBranch = repo
    ? branches.detached
      ? undefined
      : (branches.current ?? undefined)
    : session.branch;
  useEffect(() => {
    if (repo && liveBranch !== session.branch) {
      onPatch(session.id, { branch: liveBranch });
    }
  }, [repo, liveBranch, session.branch, session.id, onPatch]);
  const BranchIcon = session.worktreeCwd ? FolderTree : GitBranch;
  return (
    <div
      className={`flex h-8 shrink-0 items-center gap-2 px-3 text-[12px] text-content/50 ${
        onPaneDragStart ? "cursor-grab" : ""
      }`}
      onPointerDown={onPaneDragStart}
    >
      <HarnessIcon harness={session.harness} className="size-3.5" />
      <span className="truncate">{HARNESS_TITLE[session.harness]}</span>
      {multipleProfiles ? (
        <span className="truncate rounded-md bg-content/5 px-1.5 py-0.5 text-content/60">
          {profileLabel}
        </span>
      ) : null}
      {liveBranch ? (
        <span
          className="flex min-w-0 items-center gap-1 text-content/45"
          title={session.worktreeCwd ? `${liveBranch}\n${session.worktreeCwd}` : liveBranch}
        >
          <BranchIcon className="size-3 shrink-0" />
          <span className="truncate">{liveBranch}</span>
        </span>
      ) : null}
      <span className="flex-1" />
      {onNewTerminal ? (
        <button
          type="button"
          title="Open a terminal below this session"
          aria-label="Open a terminal below this session"
          className="grid size-6 place-items-center rounded-md hover:bg-content/5 hover:text-content"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onNewTerminal(session.id)}
        >
          <Terminal className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function NativeTerminalSurface({
  session,
  visible,
  focused,
  onPatch,
}: {
  session: Session;
  visible: boolean;
  focused: boolean;
  onPatch: Props["onPatch"];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<NativeTerminalState>({ exited: false });
  const [generation, setGeneration] = useState(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;
  const provider = session.harness as NativeProviderId;
  const cwd = sessionWorkCwd(session);
  const conversationId = session.providerSessionId!;
  const accountId = session.providerAccountId;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !visible) return;
    return attachNativeTerminal(
      session.id,
      container,
      { cwd, provider, accountId, conversationId },
      {
        onState: setState,
        onTitle: (raw) => {
          const current = sessionRef.current;
          const title = nativeTitleFromTerminal(raw, current);
          if (title) onPatchRef.current(current.id, { title });
        },
      },
    );
  }, [session.id, visible, cwd, provider, accountId, conversationId, generation]);

  useEffect(() => {
    if (visible && focused) focusNativeTerminal(session.id);
  }, [visible, focused, session.id, generation]);

  const restart = () => {
    disposeNativeTerminal(session.id);
    setState({ exited: false });
    setGeneration((value) => value + 1);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden" />
      {state.exited ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-stroke bg-background-base/95 px-3 py-2 text-[13px] text-content/70 shadow-lg">
            <span>
              {state.error ? "Could not start the session." : "Session ended."}
            </span>
            <button
              type="button"
              className="rounded-md bg-selection px-2.5 py-1 text-content hover:bg-selection-hover"
              onClick={restart}
            >
              {state.error
                ? "Try again"
                : session.harness === "antigravity"
                  ? "Start again"
                  : "Resume"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ProviderInfo = { id: NativeProviderId; installed: boolean };

let providerCache: Promise<ProviderInfo[]> | null = null;
function loadProviders(): Promise<ProviderInfo[]> {
  if (providerCache) return providerCache;
  const loading = listNativeProviders()
    .then((rows) =>
      NATIVE_PROVIDERS.map((id) => ({
        id,
        installed: rows.some((row) => row.id === id && row.installed),
      })),
    )
    .catch(() => {
      providerCache = null;
      return NATIVE_PROVIDERS.map((id) => ({ id, installed: id === "claude" }));
    });
  providerCache = loading;
  return loading;
}

function NativeSessionLauncher({
  session,
  onPatch,
}: {
  session: Session;
  onPatch: Props["onPatch"];
}) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [provider, setProvider] = useState<NativeProviderId>(
    isNativeProvider(session.harness) ? session.harness : "claude",
  );
  const accountsVersion = useSyncExternalStore(
    subscribeProviderAccounts,
    () => JSON.stringify(
      supportsProviderAccounts(provider) ? providerAccounts(provider) : [],
    ),
    () => "",
  );
  const accounts = useMemo(
    () => (supportsProviderAccounts(provider) ? providerAccounts(provider) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [provider, accountsVersion],
  );
  // The profile lives on the session, so the footer's account chip and this
  // picker always show the same one, and it is what the CLI starts with.
  const accountId = !supportsProviderAccounts(provider)
    ? DEFAULT_PROVIDER_ACCOUNT_ID
    : session.providerAccountId &&
        accounts.some((account) => account.id === session.providerAccountId)
      ? session.providerAccountId
      : selectedProviderAccountId(provider, session.cwd);
  const chooseAccount = (id: string) =>
    onPatch(session.id, { providerAccountId: id });
  const startRef = useRef<HTMLButtonElement>(null);

  // Workspace and branch are only picked here, before the CLI starts.
  const [workspace, setWorkspace] = useState<LaunchWorkspace>(() =>
    defaultLaunchWorkspace(session),
  );
  const [generatedName] = useState(() => temporaryWorktreeBranchName());
  const [preparing, setPreparing] = useState(false);
  const [launchError, setLaunchError] = useState<string>();
  const gitLookup = !!session.cwd && session.cwd !== "~";
  const { branches, settled: branchesSettled } = useProjectBranchesState(
    session.cwd,
    gitLookup,
  );
  const gitProject = isGitRepo(branches);
  const { data: worktrees, error: worktreesError } = useProjectWorktrees(
    session.cwd,
    gitProject,
  );
  const chooseWorkspace = (next: LaunchWorkspace) => {
    setWorkspace(next);
    setLaunchError(undefined);
  };
  // A remembered worktree that is gone must be picked again, not launched into.
  useEffect(() => {
    if (workspace.kind !== "existing" || !workspace.path || !worktrees) return;
    if (
      !selectableWorktrees(worktrees.worktrees).some(
        (tree) => tree.path === workspace.path,
      )
    ) {
      setWorkspace({ kind: "existing", path: "" });
    }
  }, [workspace, worktrees]);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    void loadProviders().then((rows) => {
      if (!alive) return;
      setProviders(rows);
      setProvider((current) =>
        rows.some((row) => row.id === current && row.installed)
          ? current
          : (rows.find((row) => row.installed)?.id ?? current),
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    startRef.current?.focus();
  }, [providers]);

  const installed = providers?.find((row) => row.id === provider)?.installed;
  // Settings can keep a CLI out of the picker globally or for this project.
  const projectHidden = loadProjectProviderSettings(session.cwd).hidden ?? [];
  const shown = (providers ?? NATIVE_PROVIDERS.map((id) => ({ id, installed: true })))
    .filter(
      (row) =>
        row.id === provider ||
        (isPickerProviderVisible(row.id) && !projectHidden.includes(row.id)),
    );

  const workspaceReady =
    !gitProject || workspace.kind !== "existing" || !!workspace.path;
  const canStart = !!installed && !preparing && workspaceReady;

  const start = async () => {
    if (!canStart) return;
    setPreparing(true);
    setLaunchError(undefined);
    let placement: Awaited<ReturnType<typeof prepareLaunchWorkspace>> = {};
    if (gitProject) {
      try {
        placement = await prepareLaunchWorkspace(
          session.cwd,
          workspace,
          branches,
          worktrees?.worktrees ?? [],
          generatedName,
          {
            checkout: gitCheckout,
            createBranch: gitCreateBranch,
            createWorktree: (cwd, branch, base) =>
              createWorktree(cwd, branch, base, false),
          },
        );
        if (launchSwitchesBranch(workspace, branches)) {
          // Refresh the shared branch cache before the header reads it.
          await gitBranches(session.cwd)
            .then((fresh) => seedProjectBranches(session.cwd, fresh))
            .catch(() => undefined);
        }
        notifyGitChanged();
      } catch (error) {
        if (!alive.current) return;
        const message = error instanceof Error ? error.message : String(error);
        setLaunchError(
          isCheckoutBlockedByChanges(message)
            ? "Uncommitted changes in this checkout would be overwritten. Commit or stash them first, or start in a new worktree."
            : message,
        );
        setPreparing(false);
        return;
      }
    }
    // The tab closed while Git worked; there is no session left to start.
    if (!alive.current) return;
    if (supportsProviderAccounts(provider)) {
      selectProviderAccount(provider, session.cwd, accountId);
    }
    saveLastModelChoice(provider, preferredModelId(provider));
    // Drop any terminal left from an earlier conversation in this tab.
    disposeNativeTerminal(session.id);
    markFreshNativeLaunch(session.id);
    onPatch(session.id, {
      ...placement,
      harness: provider,
      providerAccountId: supportsProviderAccounts(provider) ? accountId : undefined,
      providerSessionId: crypto.randomUUID(),
      workspaceMode: undefined,
      worktreeBase: undefined,
    });
    setPreparing(false);
  };

  const workCwdPreview = !gitProject
    ? sessionWorkCwd(session)
    : workspace.kind === "existing"
      ? workspace.path || session.cwd
      : workspace.kind === "new"
        ? `New worktree in ${worktrees?.defaultRoot ?? "the worktree folder"}`
        : session.cwd;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <form
        className="flex w-full max-w-sm flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium uppercase tracking-wide text-content/45">
            Agent
          </div>
          <div className="grid grid-cols-2 gap-2">
            {shown.map(
              (row) => (
                <button
                  key={row.id}
                  type="button"
                  disabled={!row.installed || preparing}
                  title={row.installed ? undefined : `${HARNESS_TITLE[row.id]} is not installed`}
                  onClick={() => {
                    setProvider(row.id);
                    // Profiles belong to one CLI, so the choice starts over.
                    onPatch(session.id, {
                      harness: row.id,
                      providerAccountId: undefined,
                    });
                  }}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] ${
                    provider === row.id
                      ? "border-content/30 bg-selection text-content"
                      : "border-stroke text-content/70 hover:bg-content/5"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <HarnessIcon harness={row.id as HarnessId} className="size-4" />
                  <span className="truncate">{HARNESS_TITLE[row.id]}</span>
                </button>
              ),
            )}
          </div>
        </div>
        {accounts.length > 1 ? (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-medium uppercase tracking-wide text-content/45">
              Profile
            </div>
            <div className="flex flex-wrap gap-2">
              {accounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  disabled={preparing}
                  onClick={() => chooseAccount(account.id)}
                  className={`rounded-lg border px-3 py-1.5 text-[13px] ${
                    accountId === account.id
                      ? "border-content/30 bg-selection text-content"
                      : "border-stroke text-content/70 hover:bg-content/5"
                  }`}
                >
                  {account.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {gitProject ? (
          <LaunchWorkspacePicker
            cwd={session.cwd}
            value={workspace}
            onChange={chooseWorkspace}
            branches={branches}
            worktrees={worktrees}
            worktreesError={worktreesError}
            generatedName={generatedName}
            disabled={preparing}
          />
        ) : gitLookup && !branchesSettled ? (
          <div className="h-[4.5rem]" aria-hidden />
        ) : null}
        {launchError ? (
          <p
            role="alert"
            className="whitespace-pre-wrap rounded-lg border border-red-400/25 bg-red-400/5 px-3 py-2 text-[12px] leading-4 text-red-400"
          >
            {launchError}
          </p>
        ) : null}
        <button
          ref={startRef}
          type="submit"
          disabled={!canStart}
          className="rounded-lg bg-content px-3 py-2 text-[13px] font-medium text-background-base hover:bg-content/85 disabled:opacity-40"
        >
          {providers && !installed
            ? `${HARNESS_TITLE[provider]} is not installed`
            : preparing
              ? workspace.kind === "new"
                ? "Creating worktree…"
                : "Preparing…"
              : `Start ${HARNESS_TITLE[provider]}`}
        </button>
        <div
          className="truncate text-center text-[12px] text-content/40"
          title={workCwdPreview}
        >
          {workCwdPreview}
        </div>
      </form>
    </div>
  );
}
