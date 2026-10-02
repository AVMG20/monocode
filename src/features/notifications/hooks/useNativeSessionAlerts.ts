import { useEffect, useRef } from "react";
import {
  nativeWaitingIds,
  type NativeStatusMap,
} from "../../sessions/model/nativeSessionStatus";
import type { Session } from "../../sessions/model/session";
import { announceSessionFinished, notifySession } from "../model/notifications";
import { syncDockBadge } from "../model/dockBadge";

/**
 * Banners, cues and the dock badge for native CLI sessions, driven by the
 * status their hooks report: running → idle is a finished turn, and moving
 * to waiting means the agent needs the user.
 */
export function useNativeSessionAlerts(
  sessions: Session[],
  statuses: NativeStatusMap,
  activeSessionId: string | undefined,
) {
  const previous = useRef<NativeStatusMap>(new Map());
  useEffect(() => {
    const before = previous.current;
    previous.current = statuses;
    for (const session of sessions) {
      const was = before.get(session.id);
      const now = statuses.get(session.id);
      if (was === now) continue;
      const visible = session.id === activeSessionId;
      if (now === "waiting") {
        void notifySession(
          session,
          { kind: "approval", requestId: 0 },
          visible,
        );
      } else if (now === "idle" && (was === "running" || was === "waiting")) {
        void announceSessionFinished(session, visible);
      }
    }
    syncDockBadge(sessions, nativeWaitingIds(statuses));
  }, [sessions, statuses, activeSessionId]);
}
