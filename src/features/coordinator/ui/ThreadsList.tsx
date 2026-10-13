import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatRelative } from "../../../shared/lib/relativeTime";
import {
  CheckCircle,
  ChevronRight,
  GitBranch,
  RotateCcw,
  Search,
} from "../../../shared/ui/icons";
import { TerminalSpinner } from "../../sessions/ui/TerminalSpinner";
import {
  groupThreads,
  THREAD_STATUS_LABEL,
  THREAD_STATUS_ORDER,
  type ThreadStatus,
  type ThreadView,
} from "../model/coordinator";

const COLLAPSED_KEY = "monocode:threads-collapsed";

type Collapsed = Record<ThreadStatus, boolean>;

const DEFAULT_COLLAPSED: Collapsed = {
  waiting: false,
  busy: false,
  inactive: false,
  solved: true,
};

function loadCollapsed(): Collapsed {
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

function saveCollapsed(collapsed: Collapsed): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
  } catch {
    // Remembering the fold is a convenience; it resets next launch.
  }
}

/** What an empty group is for, so the user knows what would land there. */
const EMPTY_HINT: Partial<Record<ThreadStatus, string>> = {
  waiting: "Decisions, reviews and permission requests.",
};

function matches(view: ThreadView, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    view.title.toLowerCase().includes(needle) ||
    (view.activity?.toLowerCase().includes(needle) ?? false) ||
    (view.branch?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * A Claude Project's threads, grouped by where they stand, in the panel
 * beside the coordinator's chat.
 */
export function ThreadsList({
  color,
  views,
  activeThreadId,
  onOpenThread,
  onResolve,
}: {
  color: string;
  views: readonly ThreadView[];
  activeThreadId?: string;
  onOpenThread: (sessionId: string) => void;
  onResolve: (sessionId: string, resolved: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState<Collapsed>(loadCollapsed);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const searching = !!query.trim();
  const groups = useMemo(
    () =>
      groupThreads(searching ? views.filter((v) => matches(v, query)) : views),
    [views, query, searching],
  );

  const toggle = (status: ThreadStatus) => {
    setCollapsed((current) => {
      const next = { ...current, [status]: !current[status] };
      saveCollapsed(next);
      return next;
    });
  };

  const matchCount = THREAD_STATUS_ORDER.reduce(
    (sum, status) => sum + groups[status].length,
    0,
  );

  return (
    <div
      data-threads-list=""
      className="flex h-full min-h-0 w-full flex-col font-sans"
      style={{ "--mono-color": color } as CSSProperties}
    >
      {views.length > 0 ? (
        <div className="shrink-0 px-3 pb-1 pt-2.5">
          <div className="relative flex h-7.5 items-center rounded-md border border-stroke bg-content/[0.03] focus-within:border-content/20">
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
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none py-1.5">
        {views.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] leading-relaxed text-content/45">
            No threads yet. Ask the coordinator for something and it will start
            one.
          </p>
        ) : searching && matchCount === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-content/45">
            No threads match “{query.trim()}”.
          </p>
        ) : (
          THREAD_STATUS_ORDER.map((status) => {
            const list = groups[status];
            if (searching && !list.length) return null;
            const open = searching || !collapsed[status];
            const listId = `threads-group-${status}`;
            const hint = EMPTY_HINT[status];
            return (
              <section key={status} data-thread-group={status} className="pb-1">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={listId}
                  disabled={searching}
                  onClick={() => toggle(status)}
                  className="flex h-7 w-full items-center gap-1.5 rounded-md px-3 text-left text-[11px] font-medium text-content/55 outline-none hover:text-content focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50 disabled:hover:text-content/55"
                >
                  <ChevronRight
                    aria-hidden
                    className={`size-3 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
                  />
                  <span className="truncate">
                    {THREAD_STATUS_LABEL[status]}
                  </span>
                  <span
                    className={`tabular-nums ${
                      status === "waiting" && list.length > 0
                        ? "text-amber-400"
                        : "text-content/35"
                    }`}
                  >
                    {list.length}
                  </span>
                </button>
                {open ? (
                  list.length ? (
                    <ul id={listId} className="flex flex-col gap-px px-1.5">
                      {list.map((view) => (
                        <ThreadRow
                          key={view.sessionId}
                          view={view}
                          active={view.sessionId === activeThreadId}
                          now={now}
                          onOpen={onOpenThread}
                          onResolve={onResolve}
                        />
                      ))}
                    </ul>
                  ) : hint ? (
                    <p
                      id={listId}
                      className="px-3 pb-1.5 pl-7.5 text-[11px] text-content/35"
                    >
                      {hint}
                    </p>
                  ) : null
                ) : null}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function ThreadRow({
  view,
  active,
  now,
  onOpen,
  onResolve,
}: {
  view: ThreadView;
  active: boolean;
  now: number;
  onOpen: (sessionId: string) => void;
  onResolve: (sessionId: string, resolved: boolean) => void;
}) {
  const solved = view.status === "solved";
  const time = formatRelative(view.updatedAt, now);
  const additions = view.additions ?? 0;
  const deletions = view.deletions ?? 0;
  const resolveLabel = solved ? "Reopen thread" : "Mark solved";
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
        className={`flex w-full min-w-0 flex-col rounded-md px-2.5 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent/50 ${
          active
            ? "bg-selection text-content"
            : "text-content/80 hover:bg-content/5 hover:text-content"
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {view.status === "waiting" ? (
            <span
              aria-label={view.unseen ? "Ready for review" : "Needs you"}
              role="img"
              className="size-1.5 shrink-0 rounded-full bg-amber-400"
            />
          ) : null}
          <span
            className={`min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug ${
              solved ? "text-content/60" : "text-content"
            }`}
          >
            {view.title}
          </span>
          {view.status === "busy" || view.steps ? (
            <span
              title={
                view.steps
                  ? `${view.steps.done} of ${view.steps.total} steps done`
                  : "Working"
              }
              className={`flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium tabular-nums ${
                view.status === "busy"
                  ? "border-accent/25 bg-accent/10 text-accent"
                  : "border-stroke text-content/50"
              }`}
            >
              {view.status === "busy" ? (
                <TerminalSpinner className="inline-block w-2.5 select-none text-center text-[10px] leading-none" />
              ) : view.steps && view.steps.done === view.steps.total ? (
                <CheckCircle className="size-2.5" />
              ) : null}
              {view.steps ? `${view.steps.done}/${view.steps.total}` : "Busy"}
            </span>
          ) : null}
          {time ? (
            <span className="shrink-0 text-[11px] tabular-nums text-content/40 group-focus-within:invisible group-hover:invisible">
              {time}
            </span>
          ) : null}
        </span>
        {view.activity || view.branch || additions || deletions ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px]">
            <span className="min-w-0 flex-1 truncate text-content/45">
              {view.activity}
            </span>
            {additions > 0 || deletions > 0 ? (
              <span
                className="flex shrink-0 items-center gap-1 font-semibold tabular-nums"
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
            {view.branch ? (
              <span
                className="flex max-w-[8rem] shrink-0 items-center gap-1 rounded border border-stroke px-1 py-px text-content/50"
                title={view.branch}
              >
                <GitBranch className="size-3 shrink-0" />
                <span className="min-w-0 truncate">{view.branch}</span>
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        title={resolveLabel}
        aria-label={`${resolveLabel}: ${view.title}`}
        data-tauri-drag-region="false"
        onClick={() => onResolve(view.sessionId, !solved)}
        className="pointer-events-none absolute right-2 top-1.5 grid size-5 place-items-center rounded-md text-content/50 opacity-0 outline-none hover:bg-content/10 hover:text-content focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-accent/50 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
      >
        {solved ? (
          <RotateCcw className="size-3.5" />
        ) : (
          <CheckCircle className="size-3.5" />
        )}
      </button>
    </li>
  );
}
