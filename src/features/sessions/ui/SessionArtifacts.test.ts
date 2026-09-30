// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { SessionArtifacts } from "./SessionArtifacts";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
const readTextFile = vi.hoisted(() => vi.fn());
vi.mock("../../../platform/tauri/fs", () => ({ readTextFile }));

let container: HTMLDivElement;
let root: Root;

function render(props: ComponentProps<typeof SessionArtifacts>) {
  act(() => root.render(createElement(SessionArtifacts, props)));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  readTextFile.mockReset();
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SessionArtifacts", () => {
  it("renders nothing without artifact links", () => {
    render({ blocks: [{ id: "a", role: "assistant", text: "No links." }] });
    expect(container.querySelector("[data-session-artifacts]")).toBeNull();
  });

  it("shows a pill per artifact and opens its link", () => {
    const onOpen = vi.fn();
    render({
      onOpen,
      blocks: [
        {
          id: "u",
          role: "user",
          text: "Two pages: https://claude.ai/artifact/AAAAAAAAAAAAAAAAAAAAAA and https://claude.ai/artifact/BBBBBBBBBBBBBBBBBBBBBB",
        },
      ],
    });
    const pills = [
      ...container.querySelectorAll<HTMLElement>("[data-session-artifact]"),
    ];
    expect(pills.map((pill) => pill.textContent)).toEqual([
      "Artifact 1",
      "Artifact 2",
    ]);
    act(() => pills[1].click());
    expect(onOpen).toHaveBeenCalledWith(
      "https://claude.ai/artifact/BBBBBBBBBBBBBBBBBBBBBB",
    );
  });

  it("names a published artifact after its page title", async () => {
    const page = "https://claude.ai/artifact/BXzwaEwo6RNXxfAyTN6s13";
    const published: Block = {
      id: "p",
      role: "tool",
      text: "Artifact",
      tool: {
        title: "Artifact",
        kind: "Artifact",
        status: "completed",
        detail: `Published /tmp/scratchpad/mail-flow.html at ${page} (Version 1, version id 1).`,
      },
    };
    const labels = () =>
      [...container.querySelectorAll("[data-session-artifact]")].map(
        (pill) => pill.textContent,
      );

    readTextFile.mockRejectedValueOnce(new Error("gone"));
    render({ blocks: [published] });
    await act(async () => {});
    expect(labels()).toEqual(["Mail Flow"]);

    readTextFile.mockResolvedValueOnce("<title>Ticket Mail Flow</title>");
    render({
      blocks: [
        {
          ...published,
          tool: {
            ...published.tool,
            detail: published.tool!.detail!.replace("Version 1", "Version 2"),
          },
        },
      ],
    });
    await act(async () => {});
    expect(readTextFile).toHaveBeenLastCalledWith(
      "/tmp/scratchpad/mail-flow.html",
    );
    expect(labels()).toEqual(["Ticket Mail Flow"]);
  });
});
