// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionArtifacts } from "./SessionArtifacts";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

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
          id: "a",
          role: "assistant",
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
});
