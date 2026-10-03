import {
  isFilesystemTab,
  type FilePaneTab,
} from "../../features/workspace/model/layout";
import { SHOW_FILES, SHOW_SOURCE_CONTROL } from "./features";

/**
 * Editor-pane files whose surface this build hides: working-tree reviews,
 * commit and session diffs (source control), and files opened in the
 * built-in editor. Plans, release notes, agent and terminal tabs stay.
 */
export function isHiddenSurfaceFile(file: FilePaneTab): boolean {
  if (
    !SHOW_SOURCE_CONTROL &&
    (file.review || file.changes || file.commit || file.sessionChanges)
  ) {
    return true;
  }
  return !SHOW_FILES && isFilesystemTab(file);
}
