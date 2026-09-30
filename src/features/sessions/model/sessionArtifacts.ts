import type { Block } from "./session";

/** A claude.ai artifact or Claude Doc this session made, opened or was handed. */
export type SessionArtifact = {
  /** The link's artifact id, so a share-key or title variant is one entry. */
  id: string;
  url: string;
  kind: "doc" | "artifact";
  title?: string;
  /** The local page the Artifact tool last published to this link. */
  source?: {
    path: string;
    version?: string;
    /** The publish's fallback for a page without a `<title>`. */
    title?: string;
  };
};

const ARTIFACT_URL =
  /https:\/\/(?:[a-z0-9-]+\.)*claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]+)(?:\?[^\s"'<>()[\]\\`]*)?/g;
const UUID_TAIL =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Claude Code tells the model about attach and delete with these tags. */
const ATTACHED_TAG = /<artifact-attached url="([^"]+)"(?: title="([^"]*)")?/g;
const DELETED_TAG = /<artifact-deleted url="([^"]+)"/g;
/** The Artifact tool's publish result names the file it sent. */
const PUBLISHED =
  /^Published (\S.*?) at (https:\/\/\S+?\/artifact\/[A-Za-z0-9_-]+[^\s(]*)(?: \(Version (\d+))?/m;
const OPENED = /^Opened the Artifact at (https:\/\/\S+)/m;
/** Every Claude Docs result names the doc it touched in its `frame`. */
const DOC_FRAME = /"frame":\{[^{}]*?"url":"(https:\/\/[^"]+)"/;
/** Tool names are the tool kind for tools MonoCode has no category for. */
const DOCS_TOOL = /^mcp__claude_ai_Claude_Docs__(?!guide$|query$|delete$)/;

type Found = SessionArtifact & {
  deleted?: boolean;
  /** Only names a link found elsewhere; never adds one. */
  titleOnly?: boolean;
};

const foundByBlock = new WeakMap<Block, Found[]>();

/**
 * The artifacts this session made, opened or was handed, oldest first: what
 * the Artifact tool and Claude Docs connector report, links the user sent,
 * and Claude Code's attach tags. A link that only turns up in other output (a
 * file read, a grep, the agent's own prose) is not one of them. Blocks are
 * replaced rather than mutated, so each one is scanned once however often the
 * streaming turn re-renders.
 */
export function sessionArtifacts(blocks: Block[]): SessionArtifact[] {
  const byId = new Map<string, SessionArtifact>();
  for (const block of blocks) {
    let found = foundByBlock.get(block);
    if (!found) {
      found = artifactsInBlock(block);
      foundByBlock.set(block, found);
    }
    for (const artifact of found) {
      if (artifact.deleted) {
        byId.delete(artifact.id);
        continue;
      }
      const known = byId.get(artifact.id);
      if (!known) {
        if (artifact.titleOnly) continue;
        byId.set(artifact.id, {
          id: artifact.id,
          url: artifact.url,
          kind: artifact.kind,
          title: artifact.title,
          ...(artifact.source ? { source: artifact.source } : {}),
        });
        continue;
      }
      if (artifact.kind === "doc") known.kind = "doc";
      if (artifact.title) known.title = artifact.title;
      if (artifact.source) known.source = artifact.source;
      // A share key is what lets the link open for someone else; keep it.
      if (!known.url.includes("?") && artifact.url.includes("?")) {
        known.url = artifact.url;
      }
    }
  }
  return [...byId.values()];
}

/** The id an artifact link names, ignoring a `<title>-` slug in front of it. */
export function artifactIdFromSlug(slug: string): string {
  const uuid = slug.match(UUID_TAIL);
  if (uuid) return uuid[0].toLowerCase();
  return slug.split("-").pop() || slug;
}

function artifactsInBlock(block: Block): Found[] {
  const tool = block.tool;
  if (tool) {
    if (tool.status === "failed" || !tool.detail) return [];
    if (tool.kind === "Artifact")
      return artifactToolResult(tool.detail, tool.artifactTitle);
    if (DOCS_TOOL.test(tool.kind ?? ""))
      return docsToolResult(tool.detail, tool.artifactTitle);
    // Other tools only name links found elsewhere, e.g. a browser tab list.
    return [...titlesByUrl(tool.detail)].map(([id, title]) => ({
      id,
      url: "",
      kind: "artifact",
      title,
      titleOnly: true,
    }));
  }
  if (!block.text.includes("claude.ai/")) return [];
  if (block.role === "user") return linksIn(block.text);
  if (block.role === "system") return tagsIn(block.text);
  return [];
}

function artifactToolResult(detail: string, title?: string): Found[] {
  const deleted = tagsIn(detail).filter((found) => found.deleted);
  if (deleted.length > 0) return deleted;
  const published = detail.match(PUBLISHED);
  if (published) {
    const url = trimUrl(published[2]);
    return [
      {
        ...link(url, "artifact"),
        source: {
          path: published[1],
          ...(published[3] ? { version: published[3] } : {}),
          ...(title ? { title } : {}),
        },
      },
    ];
  }
  const opened = detail.match(OPENED);
  return opened ? [link(trimUrl(opened[1]), "artifact")] : [];
}

function docsToolResult(detail: string, title?: string): Found[] {
  const url = detail.match(DOC_FRAME)?.[1];
  if (!url || !url.match(ARTIFACT_URL)) return [];
  return [{ ...link(url, "doc"), ...(title ? { title } : {}) }];
}

function linksIn(text: string): Found[] {
  return [...text.matchAll(ARTIFACT_URL)].map((match) =>
    link(trimUrl(match[0]), "artifact"),
  );
}

function tagsIn(text: string): Found[] {
  const found: Found[] = [];
  for (const match of text.matchAll(ATTACHED_TAG)) {
    const clean = match[2] ? decodeEntities(match[2]).trim() : "";
    found.push({
      ...link(match[1], "artifact"),
      ...(clean ? { title: clean } : {}),
    });
  }
  for (const match of text.matchAll(DELETED_TAG)) {
    found.push({ ...link(match[1], "artifact"), deleted: true });
  }
  return found.filter((artifact) => artifact.id);
}

function link(url: string, kind: SessionArtifact["kind"]): Found {
  const slug = url.match(/\/artifact\/([A-Za-z0-9_-]+)/)?.[1];
  return { id: slug ? artifactIdFromSlug(slug) : "", url, kind };
}

/** Titles a browser tab listing pairs with a link: `"Title" ("https://…")`. */
function titlesByUrl(text: string): Map<string, string> {
  const titles = new Map<string, string>();
  if (!text.includes("claude.ai/")) return titles;
  for (const match of text.matchAll(
    /"([^"\n]{1,200})" \("(https:\/\/[^"\s]+\/artifact\/[^"\s]+)"\)/g,
  )) {
    const { id } = link(match[2], "artifact");
    const title = decodeEntities(match[1]).trim();
    if (id && title && title !== "claude.ai") titles.set(id, title);
  }
  return titles;
}

/**
 * The name a published page gives itself: its `<title>`, or failing that its
 * first Markdown heading. This is the title claude.ai shows for the artifact.
 */
export function titleFromPage(content: string): string | undefined {
  const title =
    content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    content.match(/^#[ \t]+(.+)$/m)?.[1];
  const clean = title ? decodeEntities(title).replace(/\s+/g, " ").trim() : "";
  return clean || undefined;
}

/** `ticket-mail-flow.html` reads as "Ticket Mail Flow". */
export function titleFromFileName(path: string): string | undefined {
  const base =
    path
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]*$/, "") ?? "";
  if (!base || /^index$/i.test(base)) return undefined;
  const words = base.split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return undefined;
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
