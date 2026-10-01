import { convertFileSrc } from "@tauri-apps/api/core";
import {
  allowVideoFile,
  readBinaryFile,
} from "../../../platform/tauri/fs";
import { isVideoPath, sniffImageMime } from "../../files/model/filePreview";

export type LocalImageState =
  | { status: "loading" }
  | { status: "ready"; url: string; size: number; mimeType: string }
  | { status: "error" };

type Entry = {
  state: LocalImageState;
  refs: number;
  drop?: ReturnType<typeof setTimeout>;
  listeners: Set<() => void>;
};

export const LOADING_IMAGE: LocalImageState = { status: "loading" };

/**
 * A thumbnail, its lightbox, and the lightbox's strip all show the same file.
 * One blob URL per path serves them all; it outlives its last viewer briefly
 * so paging through the lightbox does not re-read every file.
 */
const DROP_AFTER_MS = 30_000;

const entries = new Map<string, Entry>();
const failed = new Set<string>();
const failedListeners = new Set<() => void>();
let failedVersion = 0;

function revoke(url: string) {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

function setFailed(path: string, value: boolean) {
  if (failed.has(path) === value) return;
  if (value) failed.add(path);
  else failed.delete(path);
  failedVersion += 1;
  for (const listener of failedListeners) listener();
}

function settle(path: string, entry: Entry, state: LocalImageState) {
  if (entries.get(path) !== entry) {
    if (state.status === "ready") revoke(state.url);
    return;
  }
  entry.state = state;
  setFailed(path, state.status === "error");
  for (const listener of entry.listeners) listener();
}

const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/**
 * A video can run to gigabytes, so it is never read into memory: the asset
 * protocol streams it from disk, with seeking, once the file is let through.
 */
function loadVideo(path: string, entry: Entry) {
  void allowVideoFile(path).then(
    (video) => {
      const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
      settle(path, entry, {
        status: "ready",
        url: convertFileSrc(video.path),
        size: video.size,
        mimeType: VIDEO_MIME[extension] ?? "video/mp4",
      });
    },
    () => settle(path, entry, { status: "error" }),
  );
}

function load(path: string, entry: Entry) {
  if (isVideoPath(path)) {
    loadVideo(path, entry);
    return;
  }
  void readBinaryFile(path).then(
    (bytes) => {
      const mimeType = sniffImageMime(bytes);
      if (!mimeType) {
        settle(path, entry, { status: "error" });
        return;
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      settle(path, entry, {
        status: "ready",
        url,
        size: bytes.byteLength,
        mimeType,
      });
    },
    () => settle(path, entry, { status: "error" }),
  );
}

/** Start watching a file's image; the returned function stops watching. */
export function subscribeLocalImage(
  path: string,
  listener: () => void,
): () => void {
  let entry = entries.get(path);
  if (!entry) {
    entry = { state: LOADING_IMAGE, refs: 0, listeners: new Set() };
    entries.set(path, entry);
    load(path, entry);
  }
  const current = entry;
  if (current.drop) {
    clearTimeout(current.drop);
    current.drop = undefined;
  }
  current.refs += 1;
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    current.refs -= 1;
    if (current.refs > 0) return;
    current.drop = setTimeout(() => {
      if (entries.get(path) !== current || current.refs > 0) return;
      entries.delete(path);
      if (current.state.status === "ready") revoke(current.state.url);
    }, DROP_AFTER_MS);
  };
}

export function localImageSnapshot(path: string): LocalImageState {
  return entries.get(path)?.state ?? LOADING_IMAGE;
}

/** True once a file has failed to load as an image (missing, unreadable, not an image). */
export function isLocalImageFailed(path: string): boolean {
  return failed.has(path);
}

export function subscribeFailedImages(listener: () => void): () => void {
  failedListeners.add(listener);
  return () => failedListeners.delete(listener);
}

export function failedImagesVersion(): number {
  return failedVersion;
}
