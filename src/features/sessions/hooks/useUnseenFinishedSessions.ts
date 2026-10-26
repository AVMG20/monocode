import { useRef } from "react";
import { isLiveAgentSession } from "../model/liveAgents";
import type { Session } from "../model/session";
import { nextUnseenFinishedSessions } from "../model/sessionDone";

export function useUnseenFinishedSessions(
  sessions: Session[],
  busySessionIds: ReadonlySet<string>,
  activeSessionId?: string,
  shownSessionId?: string,
): Set<string> {
  const busyForDoneRef = useRef(busySessionIds);
  const focusedForDoneRef = useRef(activeSessionId);
  const shownForDoneRef = useRef(shownSessionId);
  const unseenFinishedRef = useRef<Set<string>>(new Set());
  if (
    busyForDoneRef.current !== busySessionIds ||
    focusedForDoneRef.current !== activeSessionId ||
    shownForDoneRef.current !== shownSessionId
  ) {
    unseenFinishedRef.current = nextUnseenFinishedSessions({
      previousBusyIds: busyForDoneRef.current,
      busyIds: busySessionIds,
      previousUnseenIds: unseenFinishedRef.current,
      focusedSessionId: activeSessionId,
      shownSessionId,
      untrackedIds: new Set(
        sessions
          .filter((session) => !isLiveAgentSession(session))
          .map((session) => session.id),
      ),
    });
    busyForDoneRef.current = busySessionIds;
    focusedForDoneRef.current = activeSessionId;
    shownForDoneRef.current = shownSessionId;
  }
  return unseenFinishedRef.current;
}
