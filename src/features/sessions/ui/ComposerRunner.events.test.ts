// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerRunner } from "./ComposerRunner";
import { resetLaps } from "./runnerDirector";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetLaps();
});

it("rolls a random event after a few laps", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.spyOn(performance, "now").mockReturnValue(1000);
  let frame: FrameRequestCallback | null = null;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});

  const box = document.createElement("div");
  box.dataset.composer = "";
  vi.spyOn(box, "getBoundingClientRect").mockReturnValue({
    left: 20,
    right: 420,
    top: 400,
    bottom: 480,
    width: 400,
    height: 80,
  } as DOMRect);
  document.body.append(box);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        createElement(ComposerRunner, {
          boxRef: { current: box },
          cwd: "/work/project",
          busy: true,
          onExited: vi.fn(),
        }),
      ),
    );
    // Zombies are first in the pool: three of them, two frames each.
    const zombies = () =>
      [...document.querySelectorAll("path")].filter(
        (path) => path.getAttribute("fill") === "#7fb069",
      ).length;
    let seen = 0;
    for (let i = 1; i <= 60 * 30 && !seen; i++) {
      act(() => frame?.(1000 + i * 16));
      seen = zombies();
    }
    expect(seen).toBe(6);
  } finally {
    act(() => root.unmount());
    host.remove();
    box.remove();
  }
});
