import { describe, expect, it } from "vitest";
import {
  newChangesTab,
  newCommitTab,
  newEditorWorkspaceTab,
  newFileTab,
  newPlanTab,
  newSessionChangesTab,
  newTab,
  newTerminalFile,
  openEditorTab,
} from "../../features/workspace/model/layout";
import {
  withoutSnapshotFiles,
  type WorkspaceSnapshot,
} from "../../features/workspace/model/workspaceSnapshot";
import { isHiddenSurfaceFile } from "./hiddenSurfaces";
import { SHOW_FILES, SHOW_SOURCE_CONTROL, sidebarTabEnabled } from "./features";

function snapshot(tabs: WorkspaceSnapshot["tabs"]): WorkspaceSnapshot {
  return {
    tabs,
    sessions: [],
    activeTabId: tabs[0].id,
    projectCwd: "/repo",
    projectTerminals: [],
  };
}

describe("hidden surfaces", () => {
  it("hides source control and the file browser in this build", () => {
    expect(SHOW_SOURCE_CONTROL).toBe(false);
    expect(SHOW_FILES).toBe(false);
    expect(sidebarTabEnabled("sessions")).toBe(true);
    expect(sidebarTabEnabled("files")).toBe(false);
    expect(sidebarTabEnabled("changes")).toBe(false);
  });

  it("flags editor files and diffs but keeps plans and terminals", () => {
    expect(isHiddenSurfaceFile(newFileTab("/repo/a.ts", "/repo"))).toBe(true);
    expect(isHiddenSurfaceFile(newChangesTab("/repo"))).toBe(true);
    expect(isHiddenSurfaceFile(newSessionChangesTab("/repo", "s1"))).toBe(
      true,
    );
    expect(
      isHiddenSurfaceFile(
        newCommitTab("/repo", { sha: "abc", shortSha: "abc", subject: "x" }),
      ),
    ).toBe(true);
    expect(isHiddenSurfaceFile(newPlanTab("s1", "b1", "Plan", "/repo"))).toBe(
      false,
    );
    expect(isHiddenSurfaceFile(newTerminalFile("/repo"))).toBe(false);
  });

  it("drops restored file panes and tabs that hold nothing else", () => {
    const chat = openEditorTab(
      newTab("session-1"),
      newFileTab("/repo/a.ts", "/repo"),
    );
    const fileOnly = newEditorWorkspaceTab(newFileTab("/repo/b.ts", "/repo"));
    const plan = newEditorWorkspaceTab(newPlanTab("s1", "b1", "Plan", "/repo"));
    const saved = { ...snapshot([fileOnly, chat, plan]), activeTabId: fileOnly.id };

    const restored = withoutSnapshotFiles(saved, isHiddenSurfaceFile);

    expect(restored?.tabs.map((tab) => tab.id)).toEqual([chat.id, plan.id]);
    expect(restored?.activeTabId).toBe(chat.id);
    expect(restored?.tabs[0].editorPanes).toEqual([]);
    expect(restored?.tabs[0].layout).toEqual({ type: "leaf", id: "session-1" });
    expect(restored?.tabs[1]).toBe(plan);
  });

  it("returns null when every saved tab was a hidden surface", () => {
    const fileOnly = newEditorWorkspaceTab(newFileTab("/repo/b.ts", "/repo"));
    expect(withoutSnapshotFiles(snapshot([fileOnly]), isHiddenSurfaceFile)).toBe(
      null,
    );
  });
});
