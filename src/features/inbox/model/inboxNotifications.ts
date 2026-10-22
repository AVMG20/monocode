import type { InboxItem, InboxProvider } from "./githubTasks";
import { inboxNotificationProject } from "../../notifications/model/notificationProjects";
import type { NotificationSubject } from "../../notifications/model/notificationPreferences";

export function inboxNotificationSubject(
  item: Parameters<typeof inboxNotificationProject>[0] &
    Pick<InboxItem, "kind" | "updatedAt">,
): NotificationSubject {
  return {
    projectId: inboxNotificationProject(item).id,
    category: item.kind === "pr" ? "pullRequests" : "issues",
    occurredAt: Date.parse(item.updatedAt),
  };
}

export type InboxObservation = {
  changed: InboxItem[];
  appeared: InboxItem[];
};

/** Tracks fetched revisions separately from the user's read/unread state. */
export class InboxNotificationTracker {
  private revisions = new Map<string, number>();
  private primed = new Set<InboxProvider>();
  /** Per provider, the project paths a successful poll has covered. */
  private primedPaths = new Map<InboxProvider, Set<string>>();
  private scope: string | undefined;

  /**
   * `scope` identifies the query. A changed query exposes history, so every
   * provider takes a fresh baseline. `projectPaths`, when given, lists the
   * projects this poll covered: only a project new to the poll is baselined,
   * so switching projects cannot hide items that opened meanwhile elsewhere.
   */
  observe(
    items: readonly InboxItem[],
    scope: string,
    failedProviders: readonly InboxProvider[] = [],
    projectPaths?: readonly string[],
  ): InboxObservation {
    if (scope !== this.scope) {
      this.primed.clear();
      this.primedPaths.clear();
    }
    this.scope = scope;
    const failed = new Set(failedProviders);
    const changed: InboxItem[] = [];
    const appeared: InboxItem[] = [];
    const primedFor = (item: InboxItem) => {
      if (!this.primed.has(item.provider)) return false;
      if (!projectPaths || !item.projectPath) return true;
      return (
        this.primedPaths.get(item.provider)?.has(item.projectPath) ?? false
      );
    };
    for (const item of items) {
      if (failed.has(item.provider)) continue;
      const key = JSON.stringify([
        inboxNotificationProject(item).id,
        item.kind,
        item.id || item.number,
      ]);
      const updatedAt = Date.parse(item.updatedAt);
      if (!Number.isFinite(updatedAt)) continue;
      const previous = this.revisions.get(key);
      const primed = primedFor(item);
      if (primed && previous === undefined) {
        appeared.push(item);
        changed.push(item);
      } else if (primed && previous !== undefined && updatedAt > previous) {
        changed.push(item);
      }
      this.revisions.set(key, Math.max(previous ?? 0, updatedAt));
    }
    for (const provider of [
      "github",
      "gitlab",
      "linear",
      "jira",
      "azuredevops",
    ] as const) {
      if (failed.has(provider)) continue;
      this.primed.add(provider);
      if (!projectPaths) continue;
      const paths = this.primedPaths.get(provider) ?? new Set<string>();
      for (const path of projectPaths) paths.add(path);
      this.primedPaths.set(provider, paths);
    }
    return { changed, appeared };
  }
}
