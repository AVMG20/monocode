// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "../../../platform/tauri/fs";
import {
  ImageReferenceStrip,
  TranscriptImagesProvider,
} from "./TranscriptImages";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
  invoke: vi.fn(),
}));

vi.mock("../../../platform/tauri/fs", () => ({
  allowVideoFile: vi.fn(async (path: string) => ({ path, size: 2048 })),
  basename: (path: string) => path.split("/").pop() ?? path,
  openPathWithDefaultApp: vi.fn(async () => undefined),
  readBinaryFile: vi.fn(),
  revealPath: vi.fn(async () => undefined),
  saveFileCopyAs: vi.fn(async () => null),
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const images = [
  { path: "/shots/one.png", name: "one.png", kind: "image" as const },
  { path: "/shots/two.png", name: "two.png", kind: "image" as const },
  { path: "/shots/missing.png", name: "missing.png", kind: "image" as const },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(fs.readBinaryFile).mockImplementation(async (path) => {
    if (path.includes("missing")) throw new Error("No such file");
    return PNG;
  });
  let next = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:image-${++next}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

async function render(onReference?: (path: string) => void) {
  act(() =>
    root.render(
      createElement(
        TranscriptImagesProvider,
        { images, onReference },
        createElement(ImageReferenceStrip, {
          paths: images.map((image) => image.path),
        }),
      ),
    ),
  );
  await flush();
}

describe("transcript image gallery", () => {
  it("shows thumbnails for images that exist and pages through them", async () => {
    await render();

    expect(container.querySelectorAll("[data-image-references] img")).toHaveLength(2);
    expect(container.textContent).not.toContain("missing.png");

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open one.png full screen"]')!
        .click(),
    );
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog()?.getAttribute("aria-label")).toBe("Image preview: one.png");
    expect(dialog()?.textContent).toContain("1 / 2");
    expect(dialog()?.querySelectorAll('[aria-label^="Show "]')).toHaveLength(2);

    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })),
    );
    expect(dialog()?.getAttribute("aria-label")).toBe("Image preview: two.png");

    act(() =>
      dialog()!
        .querySelector<HTMLButtonElement>('[aria-label="Next"]')!
        .click(),
    );
    expect(dialog()?.getAttribute("aria-label")).toBe("Image preview: one.png");

    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(dialog()).toBeNull();
  });

  it("attaches an image to the next prompt from the lightbox menu", async () => {
    const onReference = vi.fn();
    await render(onReference);

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open two.png full screen"]')!
        .click(),
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    act(() =>
      dialog
        .querySelector<HTMLButtonElement>('[aria-label="More actions for two.png"]')!
        .click(),
    );
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (el) => el.textContent?.includes("Use as Reference"),
    );
    expect(item).toBeTruthy();
    act(() => item!.click());

    expect(onReference).toHaveBeenCalledWith("/shots/two.png");
    expect(dialog.textContent).toContain("Added to your prompt");
  });

  it("shows a video still and plays the video in the lightbox", async () => {
    act(() =>
      root.render(
        createElement(
          TranscriptImagesProvider,
          {
            images: [
              { path: "/clips/demo.mp4", name: "demo.mp4", kind: "video" },
              images[0],
            ],
          },
          createElement(ImageReferenceStrip, {
            paths: ["/clips/demo.mp4", images[0].path],
          }),
        ),
      ),
    );
    await flush();

    const poster = container.querySelector<HTMLVideoElement>(
      "[data-image-references] video",
    );
    expect(poster?.getAttribute("src")).toBe(
      "asset://localhost/clips/demo.mp4#t=0.1",
    );
    expect(poster?.hasAttribute("controls")).toBe(false);
    expect(fs.readBinaryFile).not.toHaveBeenCalledWith("/clips/demo.mp4");

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open demo.mp4 full screen"]')!
        .click(),
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("Video preview: demo.mp4");
    const player = dialog.querySelector<HTMLVideoElement>("video[controls]");
    expect(player?.getAttribute("src")).toBe("asset://localhost/clips/demo.mp4");
    expect(dialog.textContent).toContain("1 / 2");

    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })),
    );
    expect(dialog.getAttribute("aria-label")).toBe("Image preview: one.png");
    expect(dialog.querySelector("video[controls]")).toBeNull();
  });
});
