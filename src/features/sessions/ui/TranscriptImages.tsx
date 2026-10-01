import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { FileActionError } from "../../files/ui/FileActionError";
import { formatFileSize } from "../../files/model/filePreview";
import {
  openPathWithDefaultApp,
  revealPath,
  saveFileCopyAs,
} from "../../../platform/tauri/fs";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { LAYER } from "../../../shared/lib/layers";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Play,
  X,
} from "../../../shared/ui/icons";
import {
  transcriptMedia,
  type TranscriptImage,
} from "../model/imageReferences";
import {
  failedImagesVersion,
  isLocalImageFailed,
  localImageSnapshot,
  subscribeFailedImages,
  subscribeLocalImage,
  type LocalImageState,
} from "../model/localImages";

const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open Containing Folder";

const MENU_WIDTH = 220;

type TranscriptImagesValue = {
  open: (path: string) => void;
  onReference?: (path: string) => void;
};

const TranscriptImagesContext = createContext<TranscriptImagesValue | null>(
  null,
);

/** The bytes of a local image as a shared blob URL. */
export function useLocalImage(path: string): LocalImageState {
  const subscribe = useCallback(
    (listener: () => void) => subscribeLocalImage(path, listener),
    [path],
  );
  return useSyncExternalStore(
    subscribe,
    () => localImageSnapshot(path),
    () => localImageSnapshot(path),
  );
}

/** Images that turned out not to exist drop out of the gallery. */
function useAvailableImages(images: TranscriptImage[]): TranscriptImage[] {
  const version = useSyncExternalStore(
    subscribeFailedImages,
    failedImagesVersion,
    failedImagesVersion,
  );
  return useMemo(
    () =>
      version >= 0
        ? images.filter((image) => !isLocalImageFailed(image.path))
        : images,
    [images, version],
  );
}

/**
 * Makes every image in a chat one gallery: opening any of them pages through
 * the rest, and each offers the same actions in the chat and full screen.
 */
export function TranscriptImagesProvider({
  images,
  onReference,
  children,
}: {
  images: TranscriptImage[];
  onReference?: (path: string) => void;
  children: ReactNode;
}) {
  const [viewing, setViewing] = useState<string | null>(null);
  const value = useMemo(
    () => ({ open: setViewing, onReference }),
    [onReference],
  );
  const available = useAvailableImages(images);
  const gallery = useMemo(() => {
    if (!viewing) return available;
    if (available.some((image) => image.path === viewing)) return available;
    // Opened before the transcript listed it: still show it, on its own.
    return [...available, transcriptMedia(viewing)];
  }, [available, viewing]);

  return (
    <TranscriptImagesContext.Provider value={value}>
      {children}
      {viewing ? (
        <ImageGalleryLightbox
          images={gallery}
          path={viewing}
          onPathChange={setViewing}
          onClose={() => setViewing(null)}
          onReference={onReference}
        />
      ) : null}
    </TranscriptImagesContext.Provider>
  );
}

/**
 * Opening an image goes through the chat's gallery when there is one. Outside
 * a transcript the image gets a gallery of its own.
 */
export function useOpenTranscriptImage(image: TranscriptImage): {
  open: () => void;
  onReference?: (path: string) => void;
  lightbox: ReactNode;
} {
  const context = useContext(TranscriptImagesContext);
  const [standalone, setStandalone] = useState(false);
  const open = useCallback(() => {
    if (context) context.open(image.path);
    else setStandalone(true);
  }, [context, image.path]);
  return {
    open,
    onReference: context?.onReference,
    lightbox:
      !context && standalone ? (
        <ImageGalleryLightbox
          images={[image]}
          path={image.path}
          onPathChange={() => undefined}
          onClose={() => setStandalone(false)}
        />
      ) : null,
  };
}

/** Thumbnails for the images and videos one reply refers to. */
export function ImageReferenceStrip({
  paths,
  className = "",
}: {
  paths: string[];
  className?: string;
}) {
  if (paths.length === 0) return null;
  return (
    <div
      className={`flex flex-wrap items-start gap-2 empty:hidden ${className}`}
      data-image-references
    >
      {paths.map((path) => (
        <ImageReferenceThumbnail key={path} image={transcriptMedia(path)} />
      ))}
    </div>
  );
}

function ImageReferenceThumbnail({ image }: { image: TranscriptImage }) {
  const state = useLocalImage(image.path);
  const { open, onReference, lightbox } = useOpenTranscriptImage(image);
  const [menuOpen, setMenuOpen] = useState(false);

  if (state.status === "error") return null;

  return (
    <div className="group/image relative min-w-0 max-w-56" title={image.path}>
      <button
        type="button"
        aria-label={`Open ${image.name} full screen`}
        onClick={open}
        className="block cursor-zoom-in overflow-hidden rounded-lg border border-content/10 bg-content/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {state.status === "ready" && image.kind === "video" ? (
          <VideoPoster
            url={state.url}
            name={image.name}
            className="h-28 w-48"
          />
        ) : state.status === "ready" ? (
          <img
            src={state.url}
            alt={image.alt || image.name}
            draggable={false}
            className="block h-28 w-auto min-w-16 max-w-56 object-cover"
          />
        ) : (
          <div
            role="status"
            aria-label={`Loading ${image.name}`}
            className="h-28 w-36 animate-pulse bg-content/8"
          />
        )}
      </button>
      <ImageActionsButton
        path={image.path}
        name={image.name}
        onReference={onReference}
        onOpenChange={setMenuOpen}
        className={`absolute right-1.5 top-1.5 transition-opacity ${
          menuOpen
            ? "opacity-100"
            : "opacity-0 group-hover/image:opacity-100 focus-visible:opacity-100"
        }`}
      />
      <div className="mt-1 truncate font-sans text-[11px] text-content/45">
        {image.name}
      </div>
      {lightbox}
    </div>
  );
}

/**
 * The three-dot menu on an image: reveal it, save a copy, or attach it to the
 * next prompt.
 */
export function ImageActionsButton({
  path,
  name,
  onReference,
  onOpenChange,
  onReferenced,
  layer,
  className = "",
  variant = "overlay",
}: {
  path: string;
  name: string;
  onReference?: (path: string) => void;
  onOpenChange?: (open: boolean) => void;
  onReferenced?: () => void;
  layer?: number;
  className?: string;
  variant?: "overlay" | "toolbar";
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closedAt = useRef(0);

  const setOpen = (next: { x: number; y: number } | null) => {
    setMenu(next);
    if (!next) closedAt.current = Date.now();
    onOpenChange?.(!!next);
  };

  const items: ExplorerMenuItem[] = [
    {
      kind: "item",
      id: "reference",
      label: "Use as Reference",
      description: onReference
        ? "Attach to your next prompt"
        : "This chat cannot take attachments",
      disabled: !onReference,
    },
    { kind: "sep" },
    { kind: "item", id: "reveal", label: REVEAL_LABEL },
    { kind: "item", id: "save", label: "Save As…" },
  ];

  const pick = (id: string) => {
    setOpen(null);
    setError(null);
    if (id === "reference") {
      onReference?.(path);
      onReferenced?.();
      return;
    }
    const action =
      id === "reveal"
        ? revealPath(path)
        : id === "save"
          ? saveFileCopyAs(path).then(() => undefined)
          : null;
    void action?.catch((reason) => {
      console.error(`Failed to run image action ${id}:`, reason);
      setError(
        id === "save"
          ? `Could not save ${name}: ${String(reason)}`
          : `Could not show ${name}: ${String(reason)}`,
      );
    });
  };

  return (
    <>
      <button
        type="button"
        aria-label={`More actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        title="More actions"
        onClick={(event) => {
          event.stopPropagation();
          // The press that dismissed the menu should not reopen it.
          if (menu || Date.now() - closedAt.current < 250) {
            setOpen(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setOpen({
            x: Math.max(8, rect.right - MENU_WIDTH),
            y: rect.bottom + 4,
          });
        }}
        className={`${
          variant === "overlay"
            ? "grid size-6 place-items-center rounded-full border border-white/15 bg-black/55 text-white/85 shadow-sm backdrop-blur-md hover:bg-black/75 hover:text-white"
            : "grid size-9 place-items-center rounded-full border border-white/15 bg-black/45 text-white/80 shadow-lg backdrop-blur-md hover:bg-black/65 hover:text-white"
        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${className}`}
      >
        <MoreHorizontal
          className={variant === "overlay" ? "size-3.5" : "size-4"}
          strokeWidth={2}
        />
      </button>
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          width={MENU_WIDTH}
          layer={layer}
          items={items}
          ariaLabel={`Actions for ${name}`}
          onPick={pick}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {error ? (
        <FileActionError message={error} onDismiss={() => setError(null)} />
      ) : null}
    </>
  );
}

/** Full-screen viewer that pages through every image and video in the chat. */
export function ImageGalleryLightbox({
  images,
  path,
  onPathChange,
  onClose,
  onReference,
}: {
  images: TranscriptImage[];
  path: string;
  onPathChange: (path: string) => void;
  onClose: () => void;
  onReference?: (path: string) => void;
}) {
  const index = Math.max(
    0,
    images.findIndex((image) => image.path === path),
  );
  const current = images[index] ?? { path, name: path };
  const state = useLocalImage(current.path);
  const count = images.length;
  const closeRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const menuOpen = useRef(false);
  const menuClosedAt = useRef(0);
  const [referenced, setReferenced] = useState<string | null>(null);
  const live = useRef({ index, count, images, onClose, onPathChange });
  live.current = { index, count, images, onClose, onPathChange };

  const go = useCallback((delta: number) => {
    const { index, count, images, onPathChange } = live.current;
    if (count < 2) return;
    const next = images[(index + delta + count) % count];
    if (next) onPathChange(next.path);
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // An open menu owns the keyboard until it closes.
      if (menuOpen.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        live.current.onClose();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        go(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        const { images, onPathChange } = live.current;
        const target = images[event.key === "Home" ? 0 : images.length - 1];
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        onPathChange(target.path);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [go]);

  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [index]);

  useEffect(() => {
    if (!referenced) return;
    const timer = setTimeout(() => setReferenced(null), 1800);
    return () => clearTimeout(timer);
  }, [referenced]);

  const onMenuOpenChange = (open: boolean) => {
    menuOpen.current = open;
    if (!open) menuClosedAt.current = Date.now();
  };
  const closeFromBackdrop = () => {
    // The press that dismissed a menu is not also a request to close.
    if (menuOpen.current || Date.now() - menuClosedAt.current < 300) return;
    onClose();
  };
  const alt = current.alt || current.name;
  const video = current.kind === "video";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${video ? "Video" : "Image"} preview: ${alt}`}
      className="fixed inset-0 flex flex-col bg-black/90 font-sans text-white backdrop-blur-sm"
      style={{ zIndex: LAYER.dialog }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-white/90" title={current.path}>
            {current.name}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/50">
            {count > 1 ? (
              <span>
                {index + 1} / {count}
              </span>
            ) : null}
            {state.status === "ready" ? (
              <span>{formatFileSize(state.size)}</span>
            ) : null}
          </div>
        </div>
        {referenced === current.path ? (
          <span
            role="status"
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] text-white/85"
          >
            <Check className="size-3" strokeWidth={2.25} />
            Added to your prompt
          </span>
        ) : null}
        <ImageActionsButton
          key={current.path}
          path={current.path}
          name={current.name}
          onReference={onReference}
          onReferenced={() => setReferenced(current.path)}
          onOpenChange={onMenuOpenChange}
          layer={LAYER.dialogPopover}
          variant="toolbar"
        />
        <button
          ref={closeRef}
          type="button"
          aria-label={`Close ${video ? "video" : "image"} preview`}
          title="Close"
          onClick={onClose}
          className="grid size-9 place-items-center rounded-full border border-white/15 bg-black/45 text-white/80 shadow-lg backdrop-blur-md hover:bg-black/65 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-16 py-2"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeFromBackdrop();
        }}
      >
        {state.status === "ready" && video ? (
          <LightboxVideo key={current.path} url={state.url} path={current.path} />
        ) : state.status === "ready" ? (
          <img
            key={current.path}
            src={state.url}
            alt={alt}
            draggable={false}
            className="max-h-full max-w-full select-none rounded-sm object-contain shadow-2xl"
          />
        ) : state.status === "error" ? (
          <div role="alert" className="text-sm text-white/60">
            Could not open {current.name}.
          </div>
        ) : (
          <div role="status" className="text-sm text-white/50">
            Loading…
          </div>
        )}
        {count > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous"
              title="Previous (←)"
              onClick={() => go(-1)}
              className="absolute left-4 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/45 text-white/80 shadow-lg backdrop-blur-md hover:bg-black/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <ChevronLeft className="size-5" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="Next"
              title="Next (→)"
              onClick={() => go(1)}
              className="absolute right-4 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/45 text-white/80 shadow-lg backdrop-blur-md hover:bg-black/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <ChevronRight className="size-5" strokeWidth={2} />
            </button>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <div
          ref={stripRef}
          className="shrink-0 overflow-x-auto overscroll-contain px-4 pb-4 pt-2"
          aria-label="Images and videos in this chat"
        >
          <div className="mx-auto flex w-max gap-2">
            {images.map((image, imageIndex) => (
              <GalleryThumbnail
                key={image.path}
                image={image}
                active={imageIndex === index}
                onSelect={() => onPathChange(image.path)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

function GalleryThumbnail({
  image,
  active,
  onSelect,
}: {
  image: TranscriptImage;
  active: boolean;
  onSelect: () => void;
}) {
  const state = useLocalImage(image.path);
  return (
    <button
      type="button"
      aria-label={`Show ${image.name}`}
      aria-current={active ? "true" : undefined}
      title={image.name}
      onClick={onSelect}
      className={`size-16 shrink-0 overflow-hidden rounded-md border-2 bg-white/5 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
        active
          ? "border-white/90 opacity-100"
          : "border-transparent opacity-55 hover:opacity-90"
      }`}
    >
      {state.status === "ready" && image.kind === "video" ? (
        <VideoPoster url={state.url} name={image.name} className="size-full" compact />
      ) : state.status === "ready" ? (
        <img
          src={state.url}
          alt=""
          draggable={false}
          className="size-full object-cover"
        />
      ) : null}
    </button>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}`
    : `${minutes}:${secs}`;
}

/**
 * A still of a video's opening frame with a play mark. Only its metadata and
 * first frame are fetched; nothing plays until the lightbox opens.
 */
function VideoPoster({
  url,
  name,
  className,
  compact = false,
}: {
  url: string;
  name: string;
  className: string;
  compact?: boolean;
}) {
  const [duration, setDuration] = useState("");
  const [broken, setBroken] = useState(false);
  return (
    <span className={`relative block overflow-hidden bg-black ${className}`}>
      {broken ? null : (
        <video
          // The fragment makes WebKit paint the first frame as a poster.
          src={`${url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          disablePictureInPicture
          tabIndex={-1}
          aria-label={name}
          onLoadedMetadata={(event) =>
            setDuration(formatDuration(event.currentTarget.duration))
          }
          onError={() => setBroken(true)}
          className="pointer-events-none block size-full object-cover"
        />
      )}
      <span className="absolute inset-0 grid place-items-center">
        <span
          className={`grid place-items-center rounded-full bg-black/55 text-white shadow-md backdrop-blur-sm ${
            compact ? "size-6" : "size-9"
          }`}
        >
          <Play
            className={compact ? "ml-px size-3" : "ml-0.5 size-4"}
            strokeWidth={2}
          />
        </span>
      </span>
      {duration && !compact ? (
        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/65 px-1 py-px font-sans text-[10px] tabular-nums text-white/90">
          {duration}
        </span>
      ) : null}
    </span>
  );
}

/** The playing video in the lightbox, with a way out when WebKit cannot decode it. */
function LightboxVideo({ url, path }: { url: string; path: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 text-sm text-white/60">
        This video's format cannot be played here.
        <button
          type="button"
          onClick={() => {
            void openPathWithDefaultApp(path).catch((error) =>
              console.error("Failed to open video:", error),
            );
          }}
          className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-white/85 hover:bg-white/20"
        >
          Open in Default App
        </button>
      </div>
    );
  }
  return (
    <video
      src={url}
      controls
      autoPlay
      playsInline
      onError={() => setFailed(true)}
      className="max-h-full max-w-full rounded-sm bg-black shadow-2xl outline-none"
    />
  );
}
