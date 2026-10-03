import { lazySurface } from "../../../shared/ui/lazySurface";
import type { PointerEvent as ReactPointerEvent } from "react";
import { memo, useSyncExternalStore } from "react";
import { SurfaceTabs } from "../../workspace/ui/SurfaceTabs";
import {
  isChangesTab,
  isCommitTab,
  isReleaseNotesTab,
  isReviewTab,
  isSessionChangesTab,
  isTerminalTab,
  type EditorPane,
} from "../../workspace/model/layout";
import { isImagePath } from "../model/filePreview";
import type { TerminalMetaPatch } from "../../terminal/model/terminalTab";
import type { EditorNavigationTarget } from "../../search/model/search";
import { editorPathsEqual } from "../../search/model/search";
import {
  loadDiffViewer,
  subscribeDiffViewer,
} from "../../settings/model/settings";
import { BinaryFileView } from "./BinaryFileView";
import { ReleaseNotesSurface } from "../../../app/ui/ReleaseNotesSurface";

const CommitDiff = lazySurface(async () => {
  const module = await import("../../source-control/ui/CommitDiff");
  return { default: module.CommitDiff };
});
const FileEditor = lazySurface(async () => {
  const module = await import("./FileEditor");
  return { default: module.FileEditor };
});
const SessionChangesDiff = lazySurface(async () => {
  const module = await import("../../source-control/ui/SessionChangesDiff");
  return { default: module.SessionChangesDiff };
});
const TerminalView = lazySurface(async () => {
  const module = await import("../../terminal/ui/TerminalView");
  return { default: module.TerminalView };
});
const WorkingTreeDiff = lazySurface(async () => {
  const module = await import("../../source-control/ui/WorkingTreeDiff");
  return { default: module.WorkingTreeDiff };
});

type Props = {
  pane: EditorPane;
  focused: boolean;
  /** The title bar already names a standalone file, so avoid repeating it. */
  showTabs?: boolean;
  dirtyFileIds: Set<string>;
  fileErrorCounts: Map<string, number>;
  onFocus: (paneId: string) => void;
  onSelectFile: (paneId: string, fileId: string) => void;
  onCloseFile: (paneId: string, fileId: string) => void;
  onCloseOtherFiles: (paneId: string, fileId: string) => void;
  onPinFile?: (fileId: string) => void;
  onDirtyChange: (fileId: string, dirty: boolean) => void;
  onErrorCountChange: (fileId: string, count: number) => void;
  onReorderFiles: (paneId: string, ids: string[]) => void;
  onOpenFile: (path: string) => void;
  editorNavigation?: EditorNavigationTarget | null;
  onPaneDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  onTerminalMetaChange?: (fileId: string, patch: TerminalMetaPatch) => void;
};

function FilePaneComponent({
  pane,
  focused,
  showTabs = true,
  dirtyFileIds,
  fileErrorCounts,
  onFocus,
  onSelectFile,
  onCloseFile,
  onCloseOtherFiles,
  onPinFile,
  onDirtyChange,
  onErrorCountChange,
  onReorderFiles,
  onOpenFile,
  editorNavigation,
  onPaneDragStart,
  onTerminalMetaChange,
}: Props) {
  const diffViewer = useSyncExternalStore(
    subscribeDiffViewer,
    loadDiffViewer,
    loadDiffViewer,
  );
  const activeFile = pane.files.find((file) => file.id === pane.activeFileId);
  const sessionReview =
    activeFile && isSessionChangesTab(activeFile) ? activeFile : undefined;
  const unifiedReview =
    !!activeFile &&
    !sessionReview &&
    (isChangesTab(activeFile) ||
      (diffViewer === "unified" && isReviewTab(activeFile)));
  const commitReview = !!activeFile && isCommitTab(activeFile);

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      onMouseDown={() => onFocus(pane.id)}
    >
      {showTabs ? (
        <SurfaceTabs
          files={pane.files}
          activeFileId={pane.activeFileId}
          dirtyFileIds={dirtyFileIds}
          fileErrorCounts={fileErrorCounts}
          onSelectFile={(fileId) => onSelectFile(pane.id, fileId)}
          onCloseFile={(fileId) => onCloseFile(pane.id, fileId)}
          onCloseOtherFiles={(fileId) => onCloseOtherFiles(pane.id, fileId)}
          onPinFile={onPinFile}
          onReorder={(ids) => onReorderFiles(pane.id, ids)}
          onPaneDragStart={onPaneDragStart}
        />
      ) : null}
      <div className="relative min-h-0 flex-1">
        {sessionReview ? (
          <div className="absolute inset-0 h-full">
            <SessionChangesDiff
              cwd={sessionReview.cwd}
              sessionId={sessionReview.sessionChanges.sessionId}
              focusPath={sessionReview.path}
            />
          </div>
        ) : commitReview && activeFile?.commit ? (
          <div className="absolute inset-0 h-full">
            <CommitDiff cwd={activeFile.cwd} sha={activeFile.commit.sha} />
          </div>
        ) : unifiedReview && activeFile ? (
          <div className="absolute inset-0 h-full">
            <WorkingTreeDiff
              cwd={activeFile.cwd}
              focusPath={activeFile.path}
              focusKind={activeFile.changeKind}
            />
          </div>
        ) : null}
        {pane.files.map((file) => {
          if (
            isCommitTab(file) ||
            isChangesTab(file) ||
            isSessionChangesTab(file) ||
            (unifiedReview && isReviewTab(file))
          )
            return null;
          return (
            <div
              key={file.id}
              aria-hidden={file.id !== pane.activeFileId}
              className={
                file.id === pane.activeFileId
                  ? "absolute inset-0 h-full"
                  : "hidden"
              }
            >
              {isReleaseNotesTab(file) ? (
                <ReleaseNotesSurface source={file.releaseNotes} />
              ) : isTerminalTab(file) ? (
                <TerminalView
                  id={file.id}
                  cwd={file.cwd}
                  active={focused && file.id === pane.activeFileId}
                  onMetaChange={(patch) =>
                    onTerminalMetaChange?.(file.id, patch)
                  }
                />
              ) : isImagePath(file.path) ? (
                <BinaryFileView path={file.path} cwd={file.cwd} />
              ) : (
                <FileEditor
                  path={file.path}
                  cwd={file.cwd}
                  showDiff={!!file.review}
                  active={focused && file.id === pane.activeFileId}
                  navigation={
                    editorNavigation &&
                    editorPathsEqual(file.path, editorNavigation.path)
                      ? editorNavigation
                      : null
                  }
                  onDirtyChange={(_path, dirty) =>
                    onDirtyChange(file.id, dirty)
                  }
                  onErrorCountChange={(_path, count) =>
                    onErrorCountChange(file.id, count)
                  }
                  onOpenFile={onOpenFile}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const FilePane = memo(FilePaneComponent, (previous, next) => {
  if (
    previous.pane !== next.pane ||
    previous.focused !== next.focused ||
    previous.showTabs !== next.showTabs ||
    previous.dirtyFileIds !== next.dirtyFileIds ||
    previous.fileErrorCounts !== next.fileErrorCounts ||
    previous.onFocus !== next.onFocus ||
    previous.onSelectFile !== next.onSelectFile ||
    previous.onCloseFile !== next.onCloseFile ||
    previous.onCloseOtherFiles !== next.onCloseOtherFiles ||
    previous.onPinFile !== next.onPinFile ||
    previous.onDirtyChange !== next.onDirtyChange ||
    previous.onErrorCountChange !== next.onErrorCountChange ||
    previous.onReorderFiles !== next.onReorderFiles ||
    previous.onOpenFile !== next.onOpenFile ||
    previous.editorNavigation !== next.editorNavigation ||
    Boolean(previous.onPaneDragStart) !== Boolean(next.onPaneDragStart) ||
    previous.onTerminalMetaChange !== next.onTerminalMetaChange
  ) {
    return false;
  }

  return true;
});

