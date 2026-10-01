import { describe, expect, it } from "vitest";
import {
  blockImageReferences,
  collectTranscriptImages,
  imageReferences,
} from "./imageReferences";
import type { Block } from "./session";

const CWD = "/work/app";

describe("imageReferences", () => {
  it("finds markdown images, links, inline code, and bare paths in order", () => {
    const text = [
      "Here is the screenshot: ![home](/tmp/shots/home.png)",
      "and [the logo](assets/logo.svg) plus [icon](public/icon.webp).",
      "Saved `screens/login page.jpg` and /Users/me/Desktop/diff.PNG too.",
    ].join("\n");
    expect(imageReferences(text, CWD)).toEqual([
      "/tmp/shots/home.png",
      "/work/app/public/icon.webp",
      "/work/app/screens/login page.jpg",
      "/Users/me/Desktop/diff.PNG",
    ]);
  });

  it("keeps spaces inside angle-bracket link targets", () => {
    expect(
      imageReferences("See [shot](<out/My Shot 1.png>).", CWD),
    ).toEqual(["/work/app/out/My Shot 1.png"]);
  });

  it("ignores web URLs, code fences, and look-alike extensions", () => {
    const text = [
      "Remote: https://example.com/a.png",
      "```ts",
      'import logo from "./logo.png";',
      "```",
      "Backup at notes.png.bak and file.pngx",
    ].join("\n");
    expect(imageReferences(text, CWD)).toEqual([]);
  });

  it("lists each image once and drops line suffixes", () => {
    expect(
      imageReferences("`a/b.gif:3` then a/b.gif again", CWD),
    ).toEqual(["/work/app/a/b.gif"]);
  });

  it("finds videos the webview can play, but not other formats", () => {
    expect(
      imageReferences(
        "Recorded `out/demo.mp4`, [clip](/tmp/a.webm), /tmp/b.MOV and /tmp/c.mkv",
        CWD,
      ),
    ).toEqual(["/work/app/out/demo.mp4", "/tmp/a.webm", "/tmp/b.MOV"]);
  });

  it("skips relative paths without a project folder", () => {
    expect(imageReferences("shot.png", undefined)).toEqual([]);
    expect(imageReferences("/abs/shot.png", undefined)).toEqual([
      "/abs/shot.png",
    ]);
  });
});

describe("collectTranscriptImages", () => {
  it("joins generated and referenced images, skipping streaming replies", () => {
    const blocks: Block[] = [
      { id: "u", role: "user", text: "make a picture of /tmp/ref.png" },
      {
        id: "g",
        role: "image",
        text: "",
        image: {
          path: "/data/gen.png",
          name: "gen",
          mimeType: "image/png",
          size: 1,
          alt: "A cat",
        },
      },
      { id: "a", role: "assistant", text: "Compare with `/tmp/a.png`." },
      { id: "b", role: "assistant", text: "Also /tmp/a.png", streaming: true },
      {
        id: "c",
        role: "assistant",
        text: "And /data/gen.png, /tmp/c.jpg and the recording /tmp/clip.mov",
      },
    ];
    expect(collectTranscriptImages(blocks, CWD)).toEqual([
      { path: "/data/gen.png", name: "gen", kind: "image", alt: "A cat" },
      { path: "/tmp/a.png", name: "a.png", kind: "image" },
      { path: "/tmp/c.jpg", name: "c.jpg", kind: "image" },
      { path: "/tmp/clip.mov", name: "clip.mov", kind: "video" },
    ]);
    expect(blockImageReferences(blocks[3], CWD)).toEqual([]);
  });
});
