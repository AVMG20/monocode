import { describe, expect, it } from "vitest";
import {
  isSettingsSectionId,
  keybindingVisible,
  searchSettings,
  SETTINGS_INDEX,
  settingsSectionsByGroup,
  settingVisible,
} from "./settings";

describe("settings for hidden surfaces", () => {
  it("drops the worktrees page", () => {
    const sections = settingsSectionsByGroup().flatMap((group) =>
      group.sections.map((section) => section.id),
    );
    expect(sections).not.toContain("worktrees");
    expect(isSettingsSectionId("worktrees")).toBe(false);
  });

  it("drops file and source-control rows from the page and search", () => {
    for (const id of [
      "file-tabs",
      "format-on-save",
      "show-excluded-files",
      "project-worktrees",
      "diff-view",
    ]) {
      expect(settingVisible(id), id).toBe(false);
      expect(SETTINGS_INDEX.some((entry) => entry.id === id), id).toBe(false);
    }
    expect(settingVisible("show-archived")).toBe(true);
    expect(searchSettings("prettier")).toEqual([]);
  });

  it("keeps shortcuts for hidden surfaces out of Keybindings", () => {
    expect(keybindingVisible("App: Go to File")).toBe(false);
    expect(keybindingVisible("App: Find in Files")).toBe(false);
    expect(keybindingVisible("Composer: Toggle Workspace")).toBe(false);
    expect(keybindingVisible("App: Search")).toBe(true);
  });
});
