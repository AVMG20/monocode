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
  const [titles, setTitles] = useState(() => new Map<string, string>());
  const sources = artifacts.flatMap((artifact) =>
    artifact.source ? [{ id: artifact.id, ...artifact.source }] : [],
  );
  const key = sources
    .map((source) => `${source.id}\0${source.path}\0${source.version ?? ""}`)
    .join("\n");

  useEffect(() => {
    if (sources.length === 0) return;
    let cancelled = false;
    void Promise.all(
      sources.map(async (source) => {
        try {
          const title = titleFromPage(await readTextFile(source.path));
          return title ? ([source.id, title] as const) : null;
        } catch {
          // Scratchpads are cleaned up; the file name still names the page.
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setTitles(new Map(entries.filter((entry) => entry !== null)));
    });
    return () => {
      cancelled = true;
    };
    // `key` covers every source that matters; `sources` is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return titles;
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
