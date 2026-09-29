import type { Block } from "./session";

/** A claude.ai artifact or Claude Doc this session made, opened or was handed. */
export type SessionArtifact = {
  /** The link's artifact id, so a share-key or title variant is one entry. */
  id: string;
  url: string;
  kind: "doc" | "artifact";
  title?: string;
};

type Found = SessionArtifact & { deleted?: boolean };

const ARTIFACT_URL =
  /https:\/\/(?:[a-z0-9-]+\.)*claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]+)(?:\?[^\s"'<>()[\]\\`]*)?/g;
const UUID_TAIL =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Claude Code tells the model about attach and delete with these tags. */
const ATTACHED_TAG = /<artifact-attached url="([^"]+)"(?: title="([^"]*)")?/g;
const DELETED_TAG = /<artifact-deleted url="([^"]+)"/g;

const foundByBlock = new WeakMap<Block, Found[]>();

/**
 * Every artifact link the transcript has touched, oldest first. Blocks are
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
        byId.set(artifact.id, {
          id: artifact.id,
          url: artifact.url,
          kind: artifact.kind,
          title: artifact.title,
        });
        continue;
      }
      if (artifact.kind === "doc") known.kind = "doc";
      if (artifact.title) known.title = artifact.title;
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
  if (block.tool?.status === "failed") return [];
  const texts = [block.text, block.tool?.detail].filter(
    (text): text is string => !!text && text.includes("claude.ai/"),
  );
  if (texts.length === 0) return [];
  const docsTool = /Claude_Docs/.test(block.tool?.title ?? block.text);
  const found: Found[] = [];
  for (const text of texts) {
    const titles = titlesByUrl(text);
    for (const match of text.matchAll(ARTIFACT_URL)) {
      const url = trimUrl(match[0]);
      const id = artifactIdFromSlug(match[1]);
      found.push({
        id,
        url,
        kind: docsTool ? "doc" : "artifact",
        title: titles.get(id),
      });
    }
    for (const match of text.matchAll(DELETED_TAG)) {
      const slug = match[1].match(/\/artifact\/([A-Za-z0-9_-]+)/)?.[1];
      if (slug) {
        found.push({
          id: artifactIdFromSlug(slug),
          url: match[1],
          kind: "artifact",
          deleted: true,
        });
      }
    }
  }
  return found;
}

/**
 * Titles the text pairs with a link: Claude Code's attach tag, and a browser
 * tab listing (`"Title" ("https://…")`).
 */
function titlesByUrl(text: string): Map<string, string> {
  const titles = new Map<string, string>();
  const add = (url: string, title: string | undefined) => {
    const slug = url.match(/\/artifact\/([A-Za-z0-9_-]+)/)?.[1];
    const clean = title ? decodeEntities(title).trim() : "";
    if (slug && clean && clean !== "claude.ai") {
      titles.set(artifactIdFromSlug(slug), clean);
    }
  };
  for (const match of text.matchAll(ATTACHED_TAG)) add(match[1], match[2]);
  for (const match of text.matchAll(
    /"([^"\n]{1,200})" \("(https:\/\/[^"\s]+\/artifact\/[^"\s]+)"\)/g,
  )) {
    add(match[2], match[1]);
  }
  return titles;
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
