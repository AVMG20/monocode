import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatRelative } from "../../../shared/lib/relativeTime";
import {
  CheckCircle,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Settings,
} from "../../../shared/ui/icons";
import { MonoRailMascot } from "../../monos/ui/MonoRailMascot";
import type { MonoLook, MonoStatus } from "../../monos/model/mono";
import { TerminalSpinner } from "../../sessions/ui/TerminalSpinner";
import {
  THREAD_STATUS_ORDER,
  type ThreadStatus,
  type ThreadView,
} from "../model/coordinator";

/** How the sidebar names each group. */
const GROUP_LABEL: Record<ThreadStatus, string> = {
  waiting: "Waiting for you",
  busy: "Working",
  inactive: "Recent",
  solved: "Solved",
};

const COLLAPSED_KEY = "monocode:project-sidebar-collapsed";

type Collapsed = Record<ThreadStatus, boolean>;

const DEFAULT_COLLAPSED: Collapsed = {
  waiting: false,
  busy: false,
  inactive: false,
  solved: true,
};

export function loadCollapsedGroups(): Collapsed {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(COLLAPSED_KEY) ?? "null",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return DEFAULT_COLLAPSED;
    const saved = parsed as Partial<Record<ThreadStatus, unknown>>;
    const out = { ...DEFAULT_COLLAPSED };
    for (const status of THREAD_STATUS_ORDER) {
      if (typeof saved[status] === "boolean") out[status] = saved[status];
    }
    return out;
  } catch {
    return DEFAULT_COLLAPSED;
  }
}

function saveCollapsedGroups(collapsed: Collapsed): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
  } catch {
    // Remembering the fold is a convenience; it resets next launch.
  }
}

/**
 * Threads by group, in the order the sidebar lists them. Working threads
 * keep the order they were started in, so rows don't jump while they
 * stream; the rest put the latest activity first.
 */
export function projectThreadGroups(
  views: readonly ThreadView[],
): Record<ThreadStatus, ThreadView[]> {
  const groups: Record<ThreadStatus, ThreadView[]> = {
    waiting: [],
    busy: [],
    inactive: [],
    solved: [],
  };
  for (const view of views) groups[view.status].push(view);
  groups.busy.sort((a, b) => b.addedAt - a.addedAt);
  for (const status of ["waiting", "inactive", "solved"] as const)
    groups[status].sort((a, b) => b.updatedAt - a.updatedAt);
  return groups;
}

/**
 * What stepping through a project visits, in order: its chat (null), then
 * every thread the sidebar shows, skipping folded groups.
 */
export function projectItemOrder(
  views: readonly ThreadView[],
  collapsed: Collapsed = loadCollapsedGroups(),
): (string | null)[] {
  const groups = projectThreadGroups(views);
  return [
    null,
    ...THREAD_STATUS_ORDER.flatMap((status) =>
      collapsed[status] ? [] : groups[status].map((view) => view.sessionId),
    ),
  ];
}

function matches(view: ThreadView, needle: string): boolean {
  return (
    view.title.toLowerCase().includes(needle) ||
    (view.activity?.toLowerCase().includes(needle) ?? false) ||
    (view.branch?.toLowerCase().includes(needle) ?? false)
  );
}

/** Search shows once a project has more threads than fit at a glance. */
const SEARCH_FROM = 6;

/**
 * A Claude Project's own sidebar, in the session sidebar's place: its chat
 * with the coordinator, then every thread grouped by where it stands.
 * Whatever is picked fills the main area.
 */
export const ProjectSidebar = memo(function ProjectSidebar({
  name,
  look,
  chatStatus,
  chatUnseen,
  views,
  activeThreadId,
  topBar,
  onSelectChat,
  onSelectThread,
  onResolve,
  onOpenInTab,
  onNewThread,
  onOpenSettings,
}: {
  name: string;
  look: Pick<MonoLook, "mascot" | "color">;
  /** The coordinator's own state, for the chat row. */
  chatStatus: MonoStatus;
  /** The coordinator replied since the user last looked. */
  chatUnseen: boolean;
  views: readonly ThreadView[];
  /** The thread in the main area; null while the chat is. */
  activeThreadId: string | null;
  /** Window chrome above the header when the rail is hidden. */
  topBar?: ReactNode;
  onSelectChat: () => void;
  onSelectThread: (sessionId: string) => void;
  onResolve: (sessionId: string, resolved: boolean) => void;
  onOpenInTab: (sessionId: string) => void;
  onNewThread: () => void;
  onOpenSettings: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Collapsed>(loadCollapsedGroups);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // The box only shows from SEARCH_FROM threads; below that a leftover
  // query must not keep filtering a list with no way to clear it.
  const needle = views.length >= SEARCH_FROM ? query.trim().toLowerCase() : "";
  const searching = !!needle;
  const groups = useMemo(
    () =>
      projectThreadGroups(
        searching ? views.filter((view) => matches(view, needle)) : views,
      ),
    [views, needle, searching],
  );
  const matchCount = THREAD_STATUS_ORDER.reduce(
    (sum, status) => sum + groups[status].length,
    0,
  );

  const toggle = (status: ThreadStatus) => {
    setCollapsed((current) => {
      const next = { ...current, [status]: !current[status] };
      saveCollapsedGroups(next);
      return next;
    });
  };

  return (
    <div
      data-project-sidebar=""
      className="flex h-full min-h-0 w-full flex-col font-sans"
    >
      {topBar}
      <div
        className="flex h-10 shrink-0 select-none items-center gap-2 border-b border-stroke pl-3 pr-1.5"
        data-tauri-drag-region="deep"
      >
        <MonoRailMascot
          name={look.mascot}
          color={look.color}
          status={chatStatus}
          className="size-4 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
          {name}
        </span>
        <HeaderButton label="New thread" onClick={onNewThread}>
          <Plus className="size-4" />
        </HeaderButton>
        <HeaderButton label="Project settings" onClick={onOpenSettings}>
          <Settings className="size-4" />
        </HeaderButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none px-1.5 py-1.5">
        <button
          type="button"
          data-project-chat=""
          aria-current={activeThreadId === null ? "true" : undefined}
          onClick={onSelectChat}
          className={`flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-accent/50 ${
            activeThreadId === null
              ? "bg-selection text-content"
              : "text-content/80 hover:bg-content/5 hover:text-content"
          }`}
        >
          <MessageSquare
            aria-hidden
            className="size-4 shrink-0"
            style={{ color: look.color }}
          />
          <span className="min-w-0 flex-1 truncate font-medium">
            Project chat
          </span>
          {chatStatus === "working" ? (
            <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none text-accent" />
          ) : chatUnseen && activeThreadId !== null ? (
            <span
              role="img"
              aria-label="New reply"
              className="size-1.5 shrink-0 rounded-full bg-accent"
            />
          ) : null}
        </button>
        {views.length >= SEARCH_FROM ? (
          <div className="relative mt-1.5 flex h-7 items-center rounded-md border border-stroke bg-content/[0.03] focus-within:border-content/20">
            <Search className="pointer-events-none absolute left-2.5 size-3 shrink-0 text-content/40" />
            <input
              type="text"
              value={query}
              placeholder="Search threads…"
              aria-label="Search threads"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !query) return;
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }}
              className="h-full w-full min-w-0 bg-transparent py-0 pl-7 pr-2 text-[12px] text-content outline-none placeholder:text-content/35"
            />
          </div>
        ) : null}
        {views.length === 0 ? (
          <p className="px-2.5 py-4 text-[12px] leading-relaxed text-content/45">
            No threads yet. Ask in the project chat and it starts them, or start
            one yourself with +.
          </p>
        ) : searching && matchCount === 0 ? (
          <p className="px-2.5 py-4 text-[12px] text-content/45">
            No threads match “{query.trim()}”.
          </p>
        ) : (
          THREAD_STATUS_ORDER.map((status) => {
            const list = groups[status];
            if (!list.length) return null;
            const open = searching || !collapsed[status];
            const listId = `project-threads-${status}`;
            return (
              <section key={status} data-thread-group={status} className="mt-2">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={listId}
                  disabled={searching}
                  onClick={() => toggle(status)}
                  className="flex h-6 w-full items-center gap-1.5 rounded-md px-2.5 text-left text-[11px] font-medium text-content/50 outline-none hover:text-content focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50 disabled:hover:text-content/50"
                >
                  <span className="truncate">{GROUP_LABEL[status]}</span>
                  <span
                    className={`tabular-nums ${
                      status === "waiting"
                        ? "text-amber-400"
                        : "text-content/35"
                    }`}
                  >
                    {list.length}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className={`ml-auto size-3 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
                  />
                </button>
                {open ? (
                  <ul id={listId} className="flex flex-col gap-px">
                    {list.map((view) => (
                      <ThreadRow
                        key={view.sessionId}
                        view={view}
                        active={view.sessionId === activeThreadId}
                        now={now}
                        onOpen={onSelectThread}
                        onResolve={onResolve}
                        onOpenInTab={onOpenInTab}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
});

function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-tauri-drag-region="false"
      onClick={onClick}
      className="grid size-7 shrink-0 place-items-center rounded-md text-content/55 outline-none hover:bg-content/8 hover:text-content focus-visible:ring-1 focus-visible:ring-accent/50"
    >
      {children}
    </button>
  );
}

/** Where a thread stands, as the mark leading its row. */
function StatusMark({ status }: { status: ThreadStatus }) {
  if (status === "busy")
    return (
      <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none text-accent" />
    );
  if (status === "solved")
    return <CheckCircle className="size-3.5 text-emerald-400/80" />;
  return (
    <span
      aria-hidden
      className={`size-2 rounded-full ${
        status === "waiting" ? "bg-amber-400" : "border border-content/30"
      }`}
    />
  );
}

const ThreadRow = memo(function ThreadRow({
  view,
  active,
  now,
  onOpen,
  onResolve,
  onOpenInTab,
}: {
  view: ThreadView;
  active: boolean;
  now: number;
  onOpen: (sessionId: string) => void;
  onResolve: (sessionId: string, resolved: boolean) => void;
  onOpenInTab: (sessionId: string) => void;
}) {
  const solved = view.status === "solved";
  const time = formatRelative(view.updatedAt, now);
  const additions = view.additions ?? 0;
  const deletions = view.deletions ?? 0;
  const resolveLabel = solved ? "Reopen thread" : "Mark solved";
  const steps = view.steps;
  return (
    <li
      className="group relative"
      data-thread-row={view.sessionId}
      data-thread-status={view.status}
    >
      <button
        type="button"
        title={view.title}
        aria-current={active ? "true" : undefined}
        data-tauri-drag-region="false"
        onClick={() => onOpen(view.sessionId)}
        className={`flex w-full min-w-0 items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent/50 ${
          active
            ? "bg-selection text-content"
            : "text-content/80 hover:bg-content/5 hover:text-content"
        }`}
      >
        <span className="grid h-[18px] w-3.5 shrink-0 place-items-center">
          <StatusMark status={view.status} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className={`min-w-0 flex-1 truncate text-[13px] leading-[18px] ${
                solved ? "text-content/55" : "text-content"
              } ${view.unseen && !active ? "font-semibold" : "font-medium"}`}
            >
              {view.title}
            </span>
            {time ? (
              <span className="shrink-0 text-[11px] tabular-nums text-content/40 group-focus-within:invisible group-hover:invisible">
                {time}
              </span>
            ) : null}
          </span>
          {view.activity || steps || additions || deletions ? (
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
              <span className="min-w-0 flex-1 truncate text-content/45">
                {view.activity}
              </span>
              {steps ? (
                <span
                  title={`${steps.done} of ${steps.total} steps done`}
                  className="shrink-0 tabular-nums text-content/45"
                >
                  {steps.done}/{steps.total}
                </span>
              ) : null}
              {additions > 0 || deletions > 0 ? (
                <span
                  className="flex shrink-0 items-center gap-1 font-medium tabular-nums"
                  title={`${additions} added, ${deletions} removed`}
                >
                  {additions > 0 ? (
                    <span className="text-diff-add-fg">+{additions}</span>
                  ) : null}
                  {deletions > 0 ? (
                    <span className="text-diff-del-fg">−{deletions}</span>
                  ) : null}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
      <span className="pointer-events-none absolute right-1.5 top-1 flex gap-0.5 opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <RowAction
          label={`Open in a workspace tab: ${view.title}`}
          title="Open in a workspace tab"
          onClick={() => onOpenInTab(view.sessionId)}
        >
          <ExternalLink className="size-3.5" />
        </RowAction>
        <RowAction
          label={`${resolveLabel}: ${view.title}`}
          title={resolveLabel}
          onClick={() => onResolve(view.sessionId, !solved)}
        >
          {solved ? (
            <RotateCcw className="size-3.5" />
          ) : (
            <CheckCircle className="size-3.5" />
          )}
        </RowAction>
      </span>
    </li>
  );
});

function RowAction({
  label,
  title,
  onClick,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      data-tauri-drag-region="false"
      onClick={onClick}
      className="grid size-5 place-items-center rounded-md bg-background-base/85 text-content/55 outline-none hover:bg-content/10 hover:text-content focus-visible:ring-1 focus-visible:ring-accent/50"
    >
      {children}
    </button>
  );
}
