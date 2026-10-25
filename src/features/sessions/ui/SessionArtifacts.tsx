import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Block } from "../model/session";
import {
  sessionArtifacts,
  titleFromFileName,
  titleFromPage,
  type SessionArtifact,
} from "../model/sessionArtifacts";
import { readTextFile } from "../../../platform/tauri/fs";
import { AppWindow, File } from "../../../shared/ui/icons";

type Props = {
  blocks: Block[];
  /** Opens the link; the system browser unless a caller routes it elsewhere. */
  onOpen?: (url: string) => void;
};

/**
 * The claude.ai artifacts and Claude Docs this session is working on, one pill
 * each, docked above the composer. The link the agent printed scrolls away
 * within a turn or two; the doc it keeps editing should stay one click away.
 */
export function SessionArtifacts({ blocks, onOpen }: Props) {
  const artifacts = useMemo(() => sessionArtifacts(blocks), [blocks]);
  const pageTitles = usePageTitles(artifacts);
  if (artifacts.length === 0) return null;
  const labels = artifactLabels(artifacts, pageTitles);

  return (
    <div
      aria-label="Session artifacts"
      data-session-artifacts
      className="flex flex-wrap items-center gap-1 px-2 pb-1.5"
    >
      {artifacts.map((artifact, index) => {
        const Icon = artifact.kind === "doc" ? File : AppWindow;
        const label = labels[index];
        return (
          <button
            key={artifact.id}
            type="button"
            title={`${label}\n${artifact.url}`}
            aria-label={`Open ${label}`}
            data-session-artifact={artifact.id}
            onClick={() => {
              if (onOpen) {
                onOpen(artifact.url);
                return;
              }
              void openUrl(artifact.url).catch((error) => {
                console.error("[monocode] failed to open artifact", error);
              });
            }}
            className="flex h-6 min-w-0 max-w-72 items-center gap-1.5 rounded-full border border-content/10 bg-content/5 pr-2 pl-1.5 font-sans text-[11px] text-content/70 backdrop-blur-sm transition-colors duration-150 hover:bg-content/10 hover:text-content"
          >
            <Icon className="size-3 shrink-0 text-content/70" />
            <span className="min-w-0 truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The `<title>` of each page the agent published, read from the file it sent.
 * The publish result only names the file, and that title is what claude.ai
 * calls the artifact. Read again when a new version goes out.
 */
function usePageTitles(artifacts: SessionArtifact[]): Map<string, string> {
  const sources = artifacts.flatMap((artifact) =>
    artifact.source ? [{ id: artifact.id, ...artifact.source }] : [],
  );
  const key = sources
    .map((source) => `${source.id}\0${source.path}\0${source.version ?? ""}`)
    .join("\n");
  // Known titles show from the first render: the composer remounts on every
  // session switch, and reading each page again relabelled its pills (and
  // shifted the layout) after every switch.
  const [titles, setTitles] = useState(() => cachedTitles(sources));

  useEffect(() => {
    if (sources.length === 0) return;
    const missing = sources.filter(
      (source) => !pageTitleCache.has(pageTitleKey(source)),
    );
    if (missing.length === 0) {
      setTitles((current) => sameTitles(current, cachedTitles(sources)));
      return;
    }
    let cancelled = false;
    void Promise.all(
      missing.map(async (source) => {
        try {
          const title = titleFromPage(await readTextFile(source.path));
          rememberPageTitle(pageTitleKey(source), title || null);
        } catch {
          // Scratchpads are cleaned up; the file name still names the page.
          // Not remembered, so a file that turns up later is read then.
        }
      }),
    ).then(() => {
      if (cancelled) return;
      setTitles((current) => sameTitles(current, cachedTitles(sources)));
    });
    return () => {
      cancelled = true;
    };
    // `key` covers every source that matters; `sources` is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return titles;
}

type PageSource = { id: string; path: string; version?: unknown };

/** Titles read per artifact, file and version, kept across remounts. */
const pageTitleCache = new Map<string, string | null>();
const PAGE_TITLE_CACHE_LIMIT = 500;

function pageTitleKey(source: PageSource): string {
  // Versions count per artifact: a new artifact from a rewritten file is
  // Version 1 again, so the artifact is part of the key.
  return `${source.id}\0${source.path}\0${source.version ?? ""}`;
}

function rememberPageTitle(key: string, title: string | null) {
  pageTitleCache.delete(key);
  pageTitleCache.set(key, title);
  if (pageTitleCache.size > PAGE_TITLE_CACHE_LIMIT)
    pageTitleCache.delete(pageTitleCache.keys().next().value!);
}

function cachedTitles(sources: PageSource[]): Map<string, string> {
  const titles = new Map<string, string>();
  for (const source of sources) {
    const title = pageTitleCache.get(pageTitleKey(source));
    if (title) titles.set(source.id, title);
  }
  return titles;
}

function sameTitles(
  current: Map<string, string>,
  next: Map<string, string>,
): Map<string, string> {
  if (current.size !== next.size) return next;
  for (const [id, title] of next) if (current.get(id) !== title) return next;
  return current;
}

/**
 * A link's name, best first: what the transcript called it, the published
 * page's own title, the publish's fallback title, its file name. Untitled links are told apart by number
 * rather than by their ids.
 */
export function artifactLabels(
  artifacts: SessionArtifact[],
  pageTitles: ReadonlyMap<string, string> = new Map(),
): string[] {
  const named = artifacts.map(
    (artifact) =>
      artifact.title ??
      pageTitles.get(artifact.id) ??
      artifact.source?.title ??
      (artifact.source ? titleFromFileName(artifact.source.path) : undefined),
  );
  const untitled = new Map<string, number>();
  artifacts.forEach((artifact, index) => {
    if (named[index]) return;
    untitled.set(artifact.kind, (untitled.get(artifact.kind) ?? 0) + 1);
  });
  const seen = new Map<string, number>();
  return artifacts.map((artifact, index) => {
    const name = named[index];
    if (name) return name;
    const base = artifact.kind === "doc" ? "Claude Doc" : "Artifact";
    const n = (seen.get(artifact.kind) ?? 0) + 1;
    seen.set(artifact.kind, n);
    return (untitled.get(artifact.kind) ?? 0) > 1 ? `${base} ${n}` : base;
  });
}
