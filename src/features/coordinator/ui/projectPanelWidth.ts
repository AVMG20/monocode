import { createContext } from "react";

/**
 * One width for everything on a project's right side (its threads, a thread,
 * its settings and the coordinator's other panels), so switching between
 * them never resizes the panel.
 */
export const PROJECT_PANEL_MIN = 420;

let remembered: number | undefined;

export function projectPanelDefault(): number {
  return Math.max(
    PROJECT_PANEL_MIN,
    Math.min(960, Math.round(window.innerWidth * 0.5)),
  );
}

export function projectPanelMax(): number {
  return Math.max(
    PROJECT_PANEL_MIN,
    Math.min(1200, Math.round(window.innerWidth * 0.7)),
  );
}

/** The width the user last dragged any of them to, for this run. */
export function projectPanelWidth(): number {
  return remembered ?? projectPanelDefault();
}

export function rememberProjectPanelWidth(width: number): void {
  remembered = width;
}

/** True inside a project view: its side panels share the width above. */
export const ProjectPanelWidth = createContext(false);
