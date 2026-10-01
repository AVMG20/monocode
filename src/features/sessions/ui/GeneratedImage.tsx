import { useState } from "react";
import { formatFileSize } from "../../files/model/filePreview";
import type { GeneratedImageMeta } from "../model/session";
import {
  ImageActionsButton,
  useLocalImage,
  useOpenTranscriptImage,
} from "./TranscriptImages";

export function GeneratedImage({ image }: { image: GeneratedImageMeta }) {
  const state = useLocalImage(image.path);
  const { open, onReference, lightbox } = useOpenTranscriptImage({
    ...image,
    kind: "image",
  });
  const [menuOpen, setMenuOpen] = useState(false);

  if (state.status === "loading") {
    return (
      <div className="px-4 py-3 text-xs text-content/45" role="status">
        Loading generated image…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="px-4 py-3 text-xs text-content/50" role="alert">
        Could not open generated image.
      </div>
    );
  }

  const alt = image.alt || image.name;
  return (
    <div className="min-w-0 px-4 pb-3 pt-3">
      <div className="group/image relative inline-block max-w-full align-top">
        <button
          type="button"
          aria-label={`Open ${image.name} full screen`}
          title={`Open ${image.name} full screen`}
          onClick={open}
          className="block max-w-full cursor-zoom-in overflow-hidden rounded-xl border border-content/10 bg-content/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <img
            src={state.url}
            alt={alt}
            draggable={false}
            className="max-h-[min(70vh,640px)] max-w-full object-contain"
          />
        </button>
        <ImageActionsButton
          path={image.path}
          name={image.name}
          onReference={onReference}
          onOpenChange={setMenuOpen}
          className={`absolute right-2 top-2 transition-opacity ${
            menuOpen
              ? "opacity-100"
              : "opacity-0 group-hover/image:opacity-100 focus-visible:opacity-100"
          }`}
        />
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-content/45">
        <span className="truncate">{image.name}</span>
        <span>{formatFileSize(state.size)}</span>
      </div>
      {lightbox}
    </div>
  );
}
