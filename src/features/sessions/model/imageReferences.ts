import { basename } from "../../../platform/tauri/fs";
import { isImagePath, isVideoPath } from "../../files/model/filePreview";
import { resolveWorkspaceFileReference } from "../../../shared/lib/paths";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import type { Block } from "./session";

export type TranscriptMediaKind = "image" | "video";

/**
 * An image or video the chat shows: one the agent generated or one its reply
 * names.
 */
export type TranscriptImage = {
  path: string;
  name: string;
  kind: TranscriptMediaKind;
  alt?: string;
};

const MEDIA_EXTENSIONS = "png|jpe?g|gif|webp|avif|bmp|ico|mp4|m4v|mov|webm";
const IMAGE_EXT = `(?:${MEDIA_EXTENSIONS})`;
const MEDIA_HINT = new RegExp(`\\.${IMAGE_EXT}`, "i");

// Code fences hold source and command lines, where an image path is usually
// an import or an argument rather than something the agent is showing.
const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm;
// `[label](<path with spaces.png>)` keeps its spaces inside angle brackets.
const ANGLE_TARGET = /\]\(\s*<([^>\n]+)>/g;
const INLINE_CODE = /`([^`\n]+)`/g;
const IMAGE_SUFFIX = new RegExp(`\\.${IMAGE_EXT}(?::\\d+(?::\\d+)?)?$`, "i");
// A path-ish run of characters that ends in an image extension. URLs match
// too and are dropped by the workspace resolver.
const TOKEN = new RegExp(
  `[^\\s\`'"()<>\\[\\]{}|*,;]+\\.${IMAGE_EXT}(?![\\w-]|\\.\\w)`,
  "gi",
);

type Hit = { index: number; raw: string };

/** Mask a match so later passes cannot read part of it again. */
function blank(text: string, index: number, length: number): string {
  return text.slice(0, index) + " ".repeat(length) + text.slice(index + length);
}

export function mediaKind(path: string): TranscriptMediaKind | undefined {
  if (isImagePath(path)) return "image";
  if (isVideoPath(path)) return "video";
  return undefined;
}

/** A gallery entry for a file the chat refers to. */
export function transcriptMedia(path: string): TranscriptImage {
  return { path, name: basename(path), kind: mediaKind(path) ?? "image" };
}

/**
 * Local image and video files a reply refers to, as absolute paths in
 * reading order.
 *
 * Covers markdown images and links, inline code, and bare paths. Remote
 * sessions are skipped: their files cannot be revealed or saved from here.
 */
export function imageReferences(text: string, cwd?: string): string[] {
  if (!text || !MEDIA_HINT.test(text)) return [];
  let body = text.replace(FENCE, (match) => " ".repeat(match.length));
  const hits: Hit[] = [];

  for (const pattern of [ANGLE_TARGET, INLINE_CODE]) {
    for (const match of [...body.matchAll(pattern)]) {
      const raw = match[1].trim();
      if (!IMAGE_SUFFIX.test(raw)) continue;
      hits.push({ index: match.index, raw });
      body = blank(body, match.index, match[0].length);
    }
  }
  for (const match of body.matchAll(TOKEN)) {
    hits.push({ index: match.index, raw: match[0] });
  }

  hits.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const hit of hits) {
    const file = resolveWorkspaceFileReference(hit.raw, cwd);
    if (!file || file.path.startsWith(REMOTE_PATH_PREFIX)) continue;
    if (!mediaKind(file.path) || seen.has(file.path)) continue;
    seen.add(file.path);
    paths.push(file.path);
  }
  return paths;
}

const referenceCache = new WeakMap<Block, { cwd?: string; paths: string[] }>();

/** Image references for one finished reply, memoized per block object. */
export function blockImageReferences(block: Block, cwd?: string): string[] {
  if (block.role !== "assistant" || block.streaming) return [];
  const cached = referenceCache.get(block);
  if (cached && cached.cwd === cwd) return cached.paths;
  const paths = imageReferences(block.text, cwd);
  referenceCache.set(block, { cwd, paths });
  return paths;
}

/** Every image the chat shows, in transcript order, each path once. */
export function collectTranscriptImages(
  blocks: Block[],
  cwd?: string,
): TranscriptImage[] {
  const seen = new Set<string>();
  const images: TranscriptImage[] = [];
  const add = (image: TranscriptImage) => {
    if (seen.has(image.path)) return;
    seen.add(image.path);
    images.push(image);
  };
  for (const block of blocks) {
    if (block.role === "image" && block.image) {
      add({
        path: block.image.path,
        name: block.image.name,
        kind: "image",
        ...(block.image.alt ? { alt: block.image.alt } : {}),
      });
      continue;
    }
    for (const path of blockImageReferences(block, cwd)) {
      add(transcriptMedia(path));
    }
  }
  return images;
}
