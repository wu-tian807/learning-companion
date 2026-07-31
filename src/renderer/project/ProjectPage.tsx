import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { ProjectSnapshot } from '../../shared/projects';
import { userMessageFromError } from '../../shared/ipc-error';
import { ErrorDialog } from '../components/ErrorDialog';
import { GenerationCenter } from '../generation/GenerationCenter';
import { AssetWorkbenchHost } from '../workbench/host/AssetWorkbenchHost';
import { WorkbenchRuntimeProvider } from '../workbench/runtime/WorkbenchRuntimeProvider';
import { AssetDeleteDialog } from './AssetDeleteDialog';
import { ProjectHeaderActions } from './ProjectHeaderActions';
import { AssetRenameDialog } from './AssetRenameDialog';
import { ProjectAssetPanel } from './ProjectAssetPanel';
import {
  assetMediaLabel,
  filterAssetLoadStateByCreationKind,
} from './project-asset-view';
import { useProjectAssets } from './use-project-assets';
import { useProjectLayout } from './use-project-layout';
import { useProjectSession } from './use-project-session';
import { useRelativeTimeNow } from './use-relative-time-now';

interface ProjectPageProps {
  readonly project: ProjectSnapshot;
  readonly onBack: () => void;
  readonly onOpenSettings: () => void;
}

function BackIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="m12.5 4.5-5.5 5.5 5.5 5.5M7.5 10h7" />
    </svg>
  );
}

export function ProjectPage({
  project,
  onBack,
  onOpenSettings,
}: ProjectPageProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leftToggleRef = useRef<HTMLButtonElement>(null);
  const rightToggleRef = useRef<HTMLButtonElement>(null);
  const relativeTimeNow = useRelativeTimeNow();
  const layout = useProjectLayout();
  const { closeOverlays, openOverlay } = layout;
  const session = useProjectSession(project.id, setError);
  const assetOperations = useProjectAssets({
    projectId: project.id,
    loadState: session.loadState,
    setLoadState: session.setLoadState,
    selectedAssetId: session.selectedAssetId,
    selectAsset: session.selectAsset,
    workbenchLifecycleTaskRef: session.workbenchLifecycleTaskRef,
    setError,
  });
  const importedAssetState = useMemo(
    () =>
      filterAssetLoadStateByCreationKind(
        session.loadState,
        'imported',
      ),
    [session.loadState],
  );
  const generatedAssetState = useMemo(
    () =>
      filterAssetLoadStateByCreationKind(
        session.loadState,
        'generated',
      ),
    [session.loadState],
  );
  const importedAssetCount =
    importedAssetState.kind === 'ready'
      ? importedAssetState.assets.length
      : 0;
  const generatedAssetCount =
    generatedAssetState.kind === 'ready'
      ? generatedAssetState.assets.length
      : 0;
  const openProjectWorkspace = useCallback(async () => {
    setError(null);

    try {
      await window.learningCompanion.openProjectWorkspace({
        projectId: project.id,
      });
    } catch (openError) {
      const message = userMessageFromError(
        openError,
        '无法打开 Project 工作区。',
      );

      if (message) {
        setError(message);
      }
    }
  }, [project.id]);
  const closeOpenOverlay = useCallback(() => {
    const closingSide = openOverlay;

    if (!closingSide) {
      return;
    }

    closeOverlays();
    window.requestAnimationFrame(() => {
      if (closingSide === 'left') {
        leftToggleRef.current?.focus();
      } else {
        rightToggleRef.current?.focus();
      }
    });
  }, [closeOverlays, openOverlay]);

  useEffect(() => {
    if (!openOverlay) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeOpenOverlay();
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [closeOpenOverlay, openOverlay]);

  return (
    <main
      className="flex h-screen min-w-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_-20%,rgba(121,119,190,0.16),transparent_38%),#15191f] p-2 text-slate-100 sm:p-[15px]"
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={(event) => {
        if (
          !event.currentTarget.contains(
            event.relatedTarget as Node | null,
          )
        ) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const paths = Array.from(event.dataTransfer.files)
          .map((file) =>
            window.learningCompanion.getPathForFile(file),
          )
          .filter((path) => path.length > 0);
        void assetOperations.addPaths(paths, 'copy');
      }}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2 pb-2">
        <div className="flex min-w-0 flex-1 basis-[210px] items-center gap-[11px]">
          <button
            type="button"
            aria-label="返回首页"
            onClick={onBack}
            className="ui-icon-button grid size-[30px] place-items-center rounded-[10px] border border-white/10 text-slate-400"
          >
            <BackIcon />
          </button>
          <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-[#34384a] text-lg">
            {project.icon}
          </span>
          <span className="min-w-0">
            <h1 className="truncate text-base font-semibold">
              {project.name}
            </h1>
            <span className="mt-0.5 block text-[10px] text-slate-500">
              {session.loadState.kind === 'ready'
                ? `${importedAssetCount} 份资料 · ${generatedAssetCount} 个生成内容`
                : '正在读取资料'}
            </span>
          </span>
        </div>
        <ProjectHeaderActions
          leftOpen={layout.leftOpen}
          rightOpen={layout.rightOpen}
          leftButtonRef={leftToggleRef}
          rightButtonRef={rightToggleRef}
          onToggleLeft={layout.toggleLeft}
          onToggleRight={layout.toggleRight}
          onOpenWorkspace={() => {
            void openProjectWorkspace();
          }}
          onOpenSettings={onOpenSettings}
        />
      </header>

      <WorkbenchRuntimeProvider onError={setError}>
        <section className="relative flex min-h-0 flex-1 gap-3">
          {openOverlay && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="关闭侧栏"
              onClick={closeOpenOverlay}
              className="absolute inset-0 z-20 cursor-default rounded-[17px] bg-black/55 backdrop-blur-[2px]"
            />
          )}
          {layout.leftOpen && (
            <div
              className={
                layout.leftInline
                  ? 'h-full w-[clamp(248px,17vw,310px)] shrink-0'
                  : 'absolute inset-y-0 left-0 z-30 h-full w-[min(360px,calc(100%-20px))] shadow-2xl'
              }
            >
              <ProjectAssetPanel
                state={importedAssetState}
                selectedAssetId={session.selectedAssetId}
                selectionMode={assetOperations.selection.active}
                selectedAssetIds={
                  assetOperations.selection.selectedAssetIds
                }
                allAssetsSelected={
                  assetOperations.selection.allSelected
                }
                busy={assetOperations.busy}
                refreshingAll={assetOperations.refreshingAll}
                dragging={dragging}
                now={relativeTimeNow}
                onSelect={session.selectAsset}
                onEnterSelectionMode={
                  assetOperations.selection.enter
                }
                onExitSelectionMode={
                  assetOperations.selection.exit
                }
                onToggleSelection={
                  assetOperations.selection.toggle
                }
                onToggleAll={assetOperations.selection.toggleAll}
                onDeleteSelected={() => {
                  if (
                    assetOperations.selection.selectedAssets
                      .length > 0
                  ) {
                    assetOperations.setDeleteTargets(
                      assetOperations.selection.selectedAssets,
                    );
                  }
                }}
                onCopyAdd={() =>
                  void assetOperations.chooseAndAdd('copy')
                }
                onLinkAdd={() =>
                  void assetOperations.chooseAndAdd('link')
                }
                onRetry={session.retry}
                onRename={assetOperations.setRenameTarget}
                onReveal={(asset) =>
                  void assetOperations.revealAssetInFolder(asset)
                }
                onRelink={(asset) =>
                  void assetOperations.relinkAsset(asset)
                }
                onRefreshAll={() =>
                  void assetOperations.refreshAllAssets()
                }
                onDelete={(asset) =>
                  assetOperations.setDeleteTargets([asset])
                }
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <AssetWorkbenchHost
              projectId={project.id}
              asset={assetOperations.selectedAsset}
              mediaLabel={assetMediaLabel}
              onRelink={() => {
                if (assetOperations.selectedAsset) {
                  void assetOperations.relinkAsset(
                    assetOperations.selectedAsset,
                  );
                }
              }}
              onRefresh={() => {
                if (assetOperations.selectedAsset) {
                  void assetOperations.refreshAsset(
                    assetOperations.selectedAsset,
                  );
                }
              }}
              onReveal={() =>
                assetOperations.selectedAsset
                  ? assetOperations.revealAssetInFolder(
                      assetOperations.selectedAsset,
                    )
                  : Promise.resolve()
              }
              onOpenSettings={onOpenSettings}
              onLifecycleTaskChange={
                session.handleWorkbenchLifecycleTask
              }
              onError={setError}
            />
          </div>
          {layout.rightOpen && (
            <div
              className={
                layout.rightInline
                  ? 'h-full w-[clamp(318px,20vw,390px)] shrink-0'
                  : 'absolute inset-y-0 right-0 z-30 h-full w-[min(390px,calc(100%-20px))] shadow-2xl'
              }
            >
              <GenerationCenter
                asset={assetOperations.selectedAsset}
                state={generatedAssetState}
                selectedAssetId={session.selectedAssetId}
                busy={assetOperations.busy}
                now={relativeTimeNow}
                mediaLabel={assetMediaLabel}
                onRetry={session.retry}
                onSelect={session.selectAsset}
                onRename={assetOperations.setRenameTarget}
                onReveal={(asset) =>
                  void assetOperations.revealAssetInFolder(asset)
                }
                onRelink={(asset) =>
                  void assetOperations.relinkAsset(asset)
                }
                onDelete={(asset) =>
                  assetOperations.setDeleteTargets([asset])
                }
              />
            </div>
          )}
        </section>
      </WorkbenchRuntimeProvider>

      {dragging && (
        <div className="pointer-events-none fixed inset-4 z-40 grid place-items-center rounded-[22px] border-2 border-dashed border-indigo-300/50 bg-[#171b22]/80 backdrop-blur-sm">
          <div className="text-center">
            <p className="text-lg font-semibold text-indigo-100">
              松开以添加资料
            </p>
            <p className="mt-2 text-xs text-slate-400">
              支持一次拖入多个本地文件
            </p>
          </div>
        </div>
      )}

      {assetOperations.renameTarget && (
        <AssetRenameDialog
          asset={assetOperations.renameTarget}
          busy={assetOperations.busy}
          error={error}
          onClose={() => {
            if (!assetOperations.busy) {
              assetOperations.setRenameTarget(null);
              setError(null);
            }
          }}
          onSubmit={(name) =>
            void assetOperations.renameAsset(name)
          }
        />
      )}

      {assetOperations.deleteTargets && (
        <AssetDeleteDialog
          assets={assetOperations.deleteTargets}
          busy={assetOperations.busy}
          error={error}
          onClose={() => {
            assetOperations.setDeleteTargets(null);
            setError(null);
          }}
          onConfirm={() => void assetOperations.deleteAssets()}
        />
      )}

      {error &&
        !assetOperations.renameTarget &&
        !assetOperations.deleteTargets && (
          <ErrorDialog
            message={error}
            onClose={() => setError(null)}
          />
        )}
    </main>
  );
}
