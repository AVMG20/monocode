import { useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Block } from "../model/session";
import {
  sessionArtifacts,
  type SessionArtifact,
} from "../model/sessionArtifacts";
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
  if (artifacts.length === 0) return null;
  const labels = artifactLabels(artifacts);

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

/** Untitled links are told apart by number rather than by their ids. */
export function artifactLabels(artifacts: SessionArtifact[]): string[] {
  const untitled = new Map<string, number>();
  for (const artifact of artifacts) {
    if (artifact.title) continue;
    untitled.set(artifact.kind, (untitled.get(artifact.kind) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return artifacts.map((artifact) => {
    if (artifact.title) return artifact.title;
    const base = artifact.kind === "doc" ? "Claude Doc" : "Artifact";
    const n = (seen.get(artifact.kind) ?? 0) + 1;
    seen.set(artifact.kind, n);
    return (untitled.get(artifact.kind) ?? 0) > 1 ? `${base} ${n}` : base;
  });
}
