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
import { Terminal } from "../../../shared/ui/icons";

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
  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-col"
      onMouseDown={() => onFocus(session.id)}
    >
      {launched ? (
        <NativeSessionHeader
          session={session}
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
  onNewTerminal,
  onPaneDragStart,
}: {
  session: Session;
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
      <span className="flex-1" />
      {onNewTerminal ? (
        <button
          type="button"
          title="Open a terminal below this session"
          aria-label="Open a terminal below this session"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-content/5 hover:text-content"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onNewTerminal(session.id)}
        >
          <Terminal className="size-3.5" />
          <span>Terminal</span>
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
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col" />
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
              {state.error ? "Try again" : "Resume"}
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
  const [accountId, setAccountId] = useState<string>(() =>
    supportsProviderAccounts(provider)
      ? (session.providerAccountId ??
          selectedProviderAccountId(provider, session.cwd))
      : DEFAULT_PROVIDER_ACCOUNT_ID,
  );
  const startRef = useRef<HTMLButtonElement>(null);

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
    if (!supportsProviderAccounts(provider)) {
      setAccountId(DEFAULT_PROVIDER_ACCOUNT_ID);
      return;
    }
    setAccountId((current) =>
      providerAccounts(provider).some((account) => account.id === current)
        ? current
        : selectedProviderAccountId(provider, session.cwd),
    );
  }, [provider, session.cwd]);

  useEffect(() => {
    startRef.current?.focus();
  }, [providers]);

  const installed = providers?.find((row) => row.id === provider)?.installed;

  const start = () => {
    if (!installed) return;
    if (supportsProviderAccounts(provider)) {
      selectProviderAccount(provider, session.cwd, accountId);
    }
    markFreshNativeLaunch(session.id);
    onPatch(session.id, {
      harness: provider,
      providerAccountId: supportsProviderAccounts(provider) ? accountId : undefined,
      providerSessionId: crypto.randomUUID(),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <form
        className="flex w-full max-w-sm flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium uppercase tracking-wide text-content/45">
            Agent
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(providers ?? NATIVE_PROVIDERS.map((id) => ({ id, installed: true }))).map(
              (row) => (
                <button
                  key={row.id}
                  type="button"
                  disabled={!row.installed}
                  title={row.installed ? undefined : `${HARNESS_TITLE[row.id]} is not installed`}
                  onClick={() => setProvider(row.id)}
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
                  onClick={() => setAccountId(account.id)}
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
        <button
          ref={startRef}
          type="submit"
          disabled={!installed}
          className="rounded-lg bg-content px-3 py-2 text-[13px] font-medium text-background-base hover:bg-content/85 disabled:opacity-40"
        >
          {providers && !installed
            ? `${HARNESS_TITLE[provider]} is not installed`
            : `Start ${HARNESS_TITLE[provider]}`}
        </button>
        <div className="truncate text-center text-[12px] text-content/40">
          {sessionWorkCwd(session)}
        </div>
      </form>
    </div>
  );
}
