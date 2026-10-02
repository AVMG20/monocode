/**
 * Product feature flags for this fork. The app is scoped to AI sessions and
 * session management, so source control (git changes, diffs, branches,
 * worktrees, PR/CI) and the file browser/editor are hidden from the UI.
 *
 * The underlying code stays in place to keep upstream merges simple; flip
 * these to `true` to bring the surfaces back.
 */
export const SHOW_SOURCE_CONTROL: boolean = false;
export const SHOW_FILES: boolean = false;

/** Whether a sidebar tab ("files" = explorer, "changes" = source control) is shown. */
export function sidebarTabEnabled(tab: string): boolean {
  if (tab === "files") return SHOW_FILES;
  if (tab === "changes") return SHOW_SOURCE_CONTROL;
  return true;
}
