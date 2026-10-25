import { useRef, useState, type ReactNode } from "react";
import { Clock, File, FileDiff, ListBullet } from "../../../shared/ui/icons";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { artifactLabel, type ArtifactCard } from "../../artifacts/artifacts";
import type { MonoLook } from "../model/mono";
import { ArtifactReader } from "../../artifacts/ui/ArtifactPanel";
import { ArtifactIcon } from "../../artifacts/ui/ArtifactCard";
import { EmptyState } from "./monoPanelParts";
import { PanelStack, type StackPage } from "./PanelStack";
import type { HarnessId } from "../../sessions/model/session";
import { MonoSidebar, MonoSidebarHeader } from "./MonoSidebar";
import type { SessionChangeTotals } from "../../sessions/ui/SessionReview";
import { MonoChangesView, type MonoChangesRequest } from "./MonoChangesView";

export type MonoOverviewTab = "activity" | "documents" | "changes";

// Activity sits apart, beside the panel toggle, since it follows the chat.
// Threads have the project sidebar.
const TABS: {
  id: Exclude<MonoOverviewTab, "activity">;
  label: string;
  icon: typeof Clock;
}[] = [
  { id: "documents", label: "Documents", icon: File },
  { id: "changes", label: "Changes", icon: FileDiff },
];

/** The conversation's recorded changes, reviewed and committed on their tab. */
export type MonoOverviewChanges = {
  sessionId: string;
  cwd: string;
  /** Null while the conversation has no changes. */
  totals: SessionChangeTotals | null;
  request: MonoChangesRequest;
  textHarness?: HarnessId;
  /** The projects the Mono works on. */
  projects: readonly string[];
};

type Props = {
  open: boolean;
  agent: MonoLook;
  /** Documents it has written, oldest first. */
  documents: readonly ArtifactCard[];
  changes?: MonoOverviewChanges;
  /** The steps of the turn picked from the chat, if one is. */
  activity?: ReactNode;
  tab: MonoOverviewTab;
  onTabChange: (tab: MonoOverviewTab) => void;
  /** A document it wrote, open over the list until Back. */
  shownDocumentId?: string;
  onBackFromDocument?: () => void;
  onOpenFile?: (path: string) => void;
  onOpenDocument: (id: string) => void;
  onClose: () => void;
  windowControls?: ReactNode;
};

/**
 * What a project's chat has produced: the documents it wrote, its changes,
 * and the steps of a turn picked from the chat. Its threads have the project
 * sidebar; who it is and how it works live in its settings.
 */
export function MonoOverview({
  open,
  agent,
  documents,
  changes,
  activity,
  tab: requestedTab,
  onTabChange,
  shownDocumentId,
  onBackFromDocument = () => {},
  onOpenFile,
  onOpenDocument,
  onClose,
  windowControls,
}: Props) {
  const lock = useLockOverscroll<HTMLDivElement>();
  const tab = requestedTab;
  // Once opened, the changes stay mounted so a commit draft survives a look
  // at another tab.
  const [changesVisited, setChangesVisited] = useState(tab === "changes");
  if (tab === "changes" && !changesVisited) setChangesVisited(true);
  // The activity button toggles back to the tab it was opened from.
  const lastTab = useRef<MonoOverviewTab>(
    tab === "activity" ? "documents" : tab,
  );
  if (tab !== "activity") lastTab.current = tab;

  const pages: StackPage[] = [];
  if (shownDocumentId)
    pages.push({
      key: `document:${shownDocumentId}`,
      node: (
        <div className="flex min-h-0 flex-1 flex-col" data-mono-document-page>
          <ArtifactReader
            key={shownDocumentId}
            id={shownDocumentId}
            onBack={onBackFromDocument}
            onClose={onClose}
            onOpenFile={onOpenFile}
          />
        </div>
      ),
    });

  const tabs = TABS;
  const counts: Record<(typeof TABS)[number]["id"], number | undefined> = {
    documents: documents.length,
    changes: changes?.totals?.files,
  };

  return (
    <MonoSidebar
      open={open}
      kind="details"
      label={`${agent.name} overview`}
      color={agent.color}
      windowControls={windowControls}
    >
      <PanelStack pages={pages}>
        {/* Pages replace this header too, keeping their back button at the top. */}
        <MonoSidebarHeader
          title="Overview"
          heading={
            <OverviewTabs
              tabs={tabs}
              tab={tab}
              counts={counts}
              onChange={onTabChange}
            />
          }
          onClose={onClose}
          actions={
            <>
              <TabButton
                label="Activity"
                icon={ListBullet}
                selected={tab === "activity"}
                aria-label={
                  tab === "activity" ? "Hide activity" : "Show activity"
                }
                aria-pressed={tab === "activity"}
                onClick={() =>
                  onTabChange(tab === "activity" ? lastTab.current : "activity")
                }
              />
            </>
          }
        />
        {changes && changesVisited ? (
          <div
            role="tabpanel"
            aria-label="Changes"
            hidden={tab !== "changes"}
            className="flex min-h-0 flex-1 flex-col"
            data-mono-overview={tab === "changes" ? "changes" : undefined}
          >
            <MonoChangesView
              sessionId={changes.sessionId}
              cwd={changes.cwd}
              request={changes.request}
              textHarness={changes.textHarness}
              agentName={agent.name}
              attachedProjects={changes.projects}
            />
          </div>
        ) : null}
        <div
          ref={lock}
          role="tabpanel"
          aria-label={
            tab === "activity"
              ? "Activity"
              : tabs.find((entry) => entry.id === tab)?.label
          }
          hidden={tab === "changes"}
          className="min-h-0 flex-1 overflow-y-auto overscroll-none px-2 py-2"
          data-mono-overview={tab === "changes" ? undefined : tab}
        >
          {tab === "activity" ? (
            (activity ?? (
              <EmptyState icon={ListBullet}>
                Select the activity on one of {agent.name}&apos;s messages to
                see each step it took.
              </EmptyState>
            ))
          ) : documents.length ? (
            <ul className="flex flex-col gap-px">
              {[...documents].reverse().map((card) => (
                <li key={card.id}>
                  <DocumentRow card={card} onOpen={onOpenDocument} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={File}>
              Ask {agent.name} to write something up, like a plan or a summary,
              and it shows up here.
            </EmptyState>
          )}
        </div>
      </PanelStack>
    </MonoSidebar>
  );
}

/**
 * The overview's tabs: the open one names itself and how many it holds, the
 * others are just their icons.
 */
function OverviewTabs({
  tabs,
  tab,
  counts,
  onChange,
}: {
  tabs: typeof TABS;
  tab: MonoOverviewTab;
  counts: Record<(typeof TABS)[number]["id"], number | undefined>;
  onChange: (tab: MonoOverviewTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Overview"
      className="-ml-2 flex items-center gap-0.5"
    >
      {tabs.map(({ id, label, icon }) => {
        const selected = id === tab;
        return (
          <TabButton
            key={id}
            label={label}
            icon={icon}
            selected={selected}
            count={counts[id]}
            // Folded tabs dot their icon, as the rail does, when they hold
            // something new.
            dot={id === "changes" && !selected && !!counts[id]}
            role="tab"
            aria-selected={selected}
            aria-label={label}
            onClick={() => onChange(id)}
          />
        );
      })}
    </div>
  );
}

/**
 * An icon that, while selected, opens out into its name and count, and folds
 * back into the icon when it is not.
 */
function TabButton({
  label,
  icon: Icon,
  selected,
  count,
  dot = false,
  onClick,
  ...aria
}: {
  label: string;
  icon: typeof Clock;
  selected: boolean;
  count?: number;
  dot?: boolean;
  onClick: () => void;
  role?: "tab";
  "aria-selected"?: boolean;
  "aria-pressed"?: boolean;
  "aria-label": string;
}) {
  return (
    <button
      type="button"
      {...aria}
      title={aria["aria-label"]}
      data-tauri-drag-region="false"
      onClick={onClick}
      className={`flex h-6 items-center rounded-md px-2 text-[12px] transition-colors duration-200 ${
        selected
          ? "bg-content/8 text-content"
          : "text-content/45 hover:bg-content/5 hover:text-content/80"
      }`}
    >
      {dot ? (
        <span className="relative grid shrink-0" data-changes-dot>
          <Icon
            className="overview-tab-icon-with-dot size-3.5"
            strokeWidth={1.75}
          />
          <span
            aria-hidden
            className="absolute -top-0.5 left-2.5 size-1.5 rounded-full bg-accent"
          />
        </span>
      ) : (
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      )}
      <span
        aria-hidden={!selected}
        data-tab-label={selected ? "open" : "closed"}
        className={`grid transition-[grid-template-columns,opacity] duration-200 ease-out motion-reduce:transition-none ${
          selected ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0"
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
          <span className="pl-1.5">{label}</span>
          {count ? (
            <span className="min-w-4 rounded bg-accent px-1 text-center text-[10px] font-medium leading-4 tabular-nums text-white">
              {count}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/** A document it wrote; opens in the reader. */
function DocumentRow({
  card,
  onOpen,
}: {
  card: ArtifactCard;
  onOpen: (id: string) => void;
}) {
  const label = artifactLabel(card.kind);
  return (
    <button
      type="button"
      data-mono-document={card.id}
      aria-label={`Open ${label.toLowerCase()} ${card.title}`}
      onClick={() => onOpen(card.id)}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-content/5"
    >
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-md bg-content/6 text-content/60"
      >
        <ArtifactIcon kind={card.kind} className="size-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12px] leading-5 text-content/85">
          {card.title}
        </span>
        <span className="truncate text-[11px] leading-4 text-content/40">
          {card.summary || label}
        </span>
      </span>
    </button>
  );
}
