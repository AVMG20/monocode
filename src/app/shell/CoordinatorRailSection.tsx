import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { MoreHorizontal, Plus, Trash2 } from "../../shared/ui/icons";
import { Popover, type PopoverAnchor } from "../../shared/ui/Popover";
import { Shimmer } from "../../shared/ui/Shimmer";
import { useAnimatedReorder } from "../../shared/hooks/useAnimatedReorder";
import { projectName } from "../../shared/lib/paths";
import { MonoRailMascot } from "../../features/monos/ui/MonoRailMascot";
import {
  ColorPicker,
  MascotPicker,
} from "../../features/monos/ui/monoPanelParts";
import { NewProjectDialog } from "../../features/coordinator/ui/NewProjectDialog";
import {
  findMono,
  listAgentMonos,
  listCoordinatorProjects,
  MONO_STATUS_LABEL,
  monoLook,
  monosSnapshot,
  reorderMonos,
  saveMonoMascot,
  saveMonoName,
  subscribeMonos,
  updateMono,
  type Mono,
  type MonoState,
  type MonoStatus,
} from "../../features/monos/model/mono";

export type CoordinatorRailProps = {
  /** The project coordinator open in the main area, if any (Mono id). */
  activeId?: string;
  /** Thread counts per project (Mono id). */
  counts: ReadonlyMap<string, { waiting: number; busy: number }>;
  /** The coordinator's own state per project (Mono id). */
  states: ReadonlyMap<string, MonoState>;
  /** Projects with something finished the user has not seen. */
  unseenIds?: ReadonlySet<string>;
  onOpen: (projectId: string) => void;
  onCreate: (input: {
    name: string;
    path: string;
    instructions?: string;
  }) => void;
  onDelete: (projectId: string) => void;
  /** Folders the user has opened, to pick the project's folder from. */
  recents: readonly { path: string }[];
  /** Opens the native folder picker; resolves to a path or null. */
  onPickFolder: () => Promise<string | null>;
};

const IDLE: MonoState = { status: "idle" };
const NO_THREADS = { waiting: 0, busy: 0 };

/** The project coordinators, kept in step with the roster. */
function useCoordinatorProjects(): Mono[] {
  const snapshot = useSyncExternalStore(subscribeMonos, monosSnapshot);
  return useMemo(() => listCoordinatorProjects(), [snapshot]);
}

/** Everything a row needs to show where one project stands. */
function projectRowView(
  mono: Mono,
  { activeId, counts, states, unseenIds }: CoordinatorRailProps,
) {
  const look = monoLook(mono);
  const state = states.get(mono.id) ?? IDLE;
  const threads = counts.get(mono.id) ?? NO_THREADS;
  const selected = mono.id === activeId;
  const unseen = !selected && !!unseenIds?.has(mono.id);
  const working = state.status === "working" || threads.busy > 0;
  // The mascot moves while anything in the project runs.
  const mascotStatus: MonoStatus =
    state.status === "idle" && threads.busy > 0 ? "working" : state.status;
  const folder = mono.projects[0];
  const lines = [
    look.name,
    folder ?? "No folder",
    state.status === "idle"
      ? undefined
      : `Coordinator: ${state.activity ?? MONO_STATUS_LABEL[state.status]}`,
    threads.waiting > 0
      ? `${threads.waiting} ${threads.waiting === 1 ? "thread" : "threads"} waiting for you`
      : undefined,
    threads.busy > 0
      ? `${threads.busy} ${threads.busy === 1 ? "thread" : "threads"} busy`
      : undefined,
  ].filter((line): line is string => !!line);
  return {
    look,
    state,
    threads,
    selected,
    unseen,
    working,
    mascotStatus,
    folder,
    title: lines.join("\n"),
    ariaLabel: lines.join(", "),
  };
}

function WaitingBadge({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className="min-w-4 shrink-0 rounded-full bg-amber-400/15 px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-amber-400"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * Claude Projects on the rail, below the Monos: each is a coordinator that
 * hands the work in one folder to threads. A row shows how many threads are
 * waiting for the user and whether anything in the project is running.
 */
export function CoordinatorRailSection(props: CoordinatorRailProps) {
  const { onOpen, onCreate, onDelete, recents, onPickFolder } = props;
  const projects = useCoordinatorProjects();
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ id: string; anchor: PopoverAnchor }>();
  const ids = projects.map((mono) => mono.id);
  // Agent Monos keep their places; the projects follow them in the roster.
  const sortable = useAnimatedReorder(
    ids,
    (order) =>
      reorderMonos([...listAgentMonos().map((mono) => mono.id), ...order]),
    "y",
  );

  return (
    <div className="mb-2 shrink-0" data-coordinator-rail>
      <div className="flex items-center gap-1 px-3 pb-1.5 pt-1">
        <span className="min-w-0 flex-1 truncate px-1 text-xs leading-5 text-content/50">
          Claude Projects
        </span>
        {projects.length ? (
          <button
            type="button"
            title="New project"
            aria-label="New project"
            onClick={() => setCreating(true)}
            className="grid size-5 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/8 hover:text-content"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      <div className="flex flex-col gap-px px-2">
        {projects.length === 0 ? (
          <button
            type="button"
            data-coordinator-add
            title="New project"
            aria-label="New project"
            onClick={() => setCreating(true)}
            className="grid h-8 w-full cursor-default place-items-center rounded-md border border-dashed border-content/15 text-content/50 hover:border-content/30 hover:bg-content/5 hover:text-content"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
        {projects.map((mono) => {
          const row = projectRowView(mono, props);
          return (
            <div
              key={mono.id}
              ref={(el) => sortable.setItemRef(mono.id, el)}
              data-selected={row.selected || undefined}
              data-mono-status={row.state.status}
              className={`reorder-item project-reorder-item group relative flex h-8 cursor-default touch-none items-stretch rounded-md px-2 ${
                row.selected ? "bg-selection-strong text-content" : "opacity-65"
              }`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                if (
                  (event.target as HTMLElement | null)?.closest(
                    "[data-no-drag]",
                  )
                )
                  return;
                sortable.onItemPointerDown(mono.id, event);
              }}
              onClick={(event) => {
                if (
                  (event.target as HTMLElement | null)?.closest(
                    "[data-no-drag]",
                  )
                )
                  return;
                if (sortable.consumeClick()) return;
                onOpen(mono.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({
                  id: mono.id,
                  anchor: { x: event.clientX, y: event.clientY },
                });
              }}
            >
              <button
                type="button"
                title={row.title}
                aria-label={row.ariaLabel}
                aria-current={row.selected ? "true" : undefined}
                className="flex min-w-0 flex-1 cursor-default items-center gap-2 text-left transition-[padding] duration-150 motion-reduce:transition-none group-hover:pr-6 group-has-[button:focus-visible]:pr-6"
              >
                <MonoRailMascot
                  name={row.look.mascot}
                  color={row.look.color}
                  status={row.mascotStatus}
                />
                {row.working ? (
                  <Shimmer
                    as="span"
                    duration={1.4}
                    className="min-w-0 flex-1 truncate text-sm font-medium leading-tight"
                  >
                    {row.look.name}
                  </Shimmer>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
                    {row.look.name}
                  </span>
                )}
                {row.threads.waiting > 0 || row.unseen ? (
                  <span className="flex shrink-0 items-center gap-1.5 group-hover:hidden group-has-[button:focus-visible]:hidden">
                    {row.threads.waiting > 0 ? (
                      <WaitingBadge count={row.threads.waiting} />
                    ) : null}
                    {row.unseen ? (
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full bg-content/60"
                      />
                    ) : null}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                data-no-drag
                title="Project options"
                aria-label={`${row.look.name} options`}
                aria-haspopup="menu"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setMenu({ id: mono.id, anchor: event.currentTarget });
                }}
                className="absolute right-1 top-1/2 hidden size-6 -translate-y-1/2 place-items-center rounded-md text-content/55 hover:bg-content/8 hover:text-content group-hover:grid group-has-[button:focus-visible]:grid"
              >
                <MoreHorizontal className="size-4" strokeWidth={1.75} />
              </button>
            </div>
          );
        })}
      </div>
      {menu ? (
        <CoordinatorMenu
          key={menu.id}
          projectId={menu.id}
          anchor={menu.anchor}
          onDelete={() => {
            setMenu(undefined);
            onDelete(menu.id);
          }}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
      {creating ? (
        <NewProjectDialog
          recents={recents}
          onPickFolder={onPickFolder}
          onCreate={(input) => {
            setCreating(false);
            onCreate(input);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * The compact rail's Claude Projects: one mascot button per project and a
 * plus for a new one. Choosing the open project again calls `onReselect`
 * (the compact rail uses it).
 */
export function CompactCoordinatorItems({
  onReselect,
  ...props
}: CoordinatorRailProps & { onReselect?: () => void }) {
  const { onOpen, onCreate, onDelete, recents, onPickFolder } = props;
  const projects = useCoordinatorProjects();
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ id: string; anchor: PopoverAnchor }>();

  return (
    <div
      role="group"
      aria-label="Claude Projects"
      data-coordinator-rail
      className="flex w-full flex-col items-center gap-1.5"
    >
      {projects.map((mono) => {
        const row = projectRowView(mono, props);
        return (
          <button
            key={mono.id}
            type="button"
            title={row.title}
            aria-label={row.ariaLabel}
            aria-pressed={row.selected}
            onClick={() => {
              if (row.selected && onReselect) onReselect();
              else onOpen(mono.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenu({
                id: mono.id,
                anchor: { x: event.clientX, y: event.clientY },
              });
            }}
            className={`relative grid size-8 shrink-0 place-items-center rounded-md active:scale-[0.97] ${
              row.selected
                ? "bg-selection text-content"
                : "opacity-75 hover:bg-content/10 hover:opacity-100"
            }`}
          >
            <MonoRailMascot
              name={row.look.mascot}
              color={row.look.color}
              status={row.mascotStatus}
            />
            {row.threads.waiting > 0 ? (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-amber-400 px-0.5 text-center text-[9px] font-semibold leading-3.5 tabular-nums text-black"
              >
                {row.threads.waiting > 9 ? "9+" : row.threads.waiting}
              </span>
            ) : row.unseen ? (
              <span
                aria-hidden
                className="absolute bottom-1 right-1 size-1.5 rounded-full bg-content/60"
              />
            ) : null}
          </button>
        );
      })}
      <button
        type="button"
        title="New project"
        aria-label="New project"
        onClick={() => setCreating(true)}
        className="grid size-8 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content active:scale-[0.97]"
      >
        <Plus className="size-4" strokeWidth={1.75} />
      </button>
      {menu ? (
        <CoordinatorMenu
          key={menu.id}
          projectId={menu.id}
          anchor={menu.anchor}
          onDelete={() => {
            setMenu(undefined);
            onDelete(menu.id);
          }}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
      {creating ? (
        <NewProjectDialog
          recents={recents}
          onPickFolder={onPickFolder}
          onCreate={(input) => {
            setCreating(false);
            onCreate(input);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Right-click menu for a project: its name, mascot and color, edited in
 * place, then Delete.
 */
function CoordinatorMenu({
  projectId,
  anchor,
  onDelete,
  onClose,
}: {
  projectId: string;
  anchor: PopoverAnchor;
  onDelete: () => void;
  onClose: () => void;
}) {
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  const mono = findMono(projectId);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(mono?.name ?? "");

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  if (!mono) return null;
  const look = monoLook(mono);
  const folder = mono.projects[0];
  // A project always has a name; clearing the field keeps the old one.
  const commitName = () => {
    const next = name.trim().slice(0, 40);
    if (next && next !== (findMono(projectId)?.name ?? ""))
      saveMonoName(projectId, next);
  };

  return (
    <Popover
      anchor={anchor}
      side="right"
      align="start"
      gap={0}
      width={280}
      constrainHeight={false}
      onDismiss={() => {
        commitName();
        onClose();
      }}
      role="menu"
      aria-label="Project options"
      onContextMenu={(event) => event.preventDefault()}
      className="p-2"
    >
      <input
        ref={input}
        value={name}
        placeholder={folder ? projectName(folder) : look.name}
        maxLength={40}
        aria-label="Project name"
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commitName();
          onClose();
        }}
        className="mb-2 w-full rounded-lg border border-content/10 bg-content/5 px-2.5 py-1.5 text-[13px] text-content outline-none ring-accent/40 placeholder:text-content/45 focus:ring-1"
      />
      {folder ? (
        <p
          title={folder}
          className="mb-2 truncate px-0.5 text-[11px] leading-4 text-content/45"
        >
          {folder}
        </p>
      ) : null}
      <div className="mb-2 flex flex-col gap-2">
        <MascotPicker
          current={look.mascot}
          color={look.color}
          onPick={(mascot) => saveMonoMascot(projectId, mascot)}
        />
        <ColorPicker
          inline
          current={look.color}
          onPick={(color) =>
            updateMono(projectId, (mono) => ({ ...mono, color }))
          }
        />
      </div>
      <div role="separator" className="my-1 h-px bg-content/10" />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          commitName();
          onDelete();
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-red-400 hover:bg-content/8"
      >
        <Trash2 className="size-3.5 shrink-0" strokeWidth={1.75} />
        Delete project…
      </button>
    </Popover>
  );
}
