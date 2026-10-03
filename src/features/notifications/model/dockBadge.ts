import { invoke } from "@tauri-apps/api/core";
import { sessionNeedsInput, type Session } from "../../sessions/model/session";

let lastCount = -1;

/**
 * Push the pending-approval count to the macOS Dock badge. `waitingIds` are
 * native CLI sessions whose hooks report they are waiting on the user.
 */
export function syncDockBadge(
  sessions: Session[],
  waitingIds: ReadonlySet<string> = new Set(),
): void {
  let count = 0;
  for (const session of sessions) {
    if (sessionNeedsInput(session) || waitingIds.has(session.id)) count++;
  }
  if (count === lastCount) return;
  lastCount = count;
  void invoke("set_dock_badge", { count }).catch(() => {});
}
