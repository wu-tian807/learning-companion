import { useState } from 'react';

import type { ProjectSnapshot } from '../../shared/projects';
import { ErrorDialog } from '../components/ErrorDialog';
import { GenerationCenter } from '../generation/GenerationCenter';
import { AssetWorkbenchHost } from '../workbench/host/AssetWorkbenchHost';
import { WorkbenchRuntimeProvider } from '../workbench/runtime/WorkbenchRuntimeProvider';
import { AssetDeleteDialog } from './AssetDeleteDialog';
import { AssetRenameDialog } from './AssetRenameDialog';
import { ProjectAssetPanel } from './ProjectAssetPanel';
import { assetMediaLabel } from './project-asset-view';
import { useProjectAssets } from './use-project-assets';
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

function SettingsIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="2.5" />
      <path d="M16.2 11.4v-2.8l-1.8-.5a5 5 0 0 0-.5-1.1l.9-1.7-2-2-1.7.9a5 5 0 0 0-1.1-.5L9.4 2H6.6l-.5 1.8a5 5 0 0 0-1.1.5l-1.7-.9-2 2 .9 1.7a5 5 0 0 0-.5 1.1L0 8.6v2.8l1.8.5a5 5 0 0 0 .5 1.1l-.9 1.7 2 2 1.7-.9a5 5 0 0 0 1.1.5l.5 1.8h2.8l.5-1.8a5 5 0 0 0 1.1-.5l1.7.9 2-2-.9-1.7a5 5 0 0 0 .5-1.1l1.8-.5Z" transform="translate(2 0) scale(.8 1)" />
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
  const relativeTimeNow = useRelativeTimeNow();
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

  return (
    <main
      className="h-screen min-w-[1080px] overflow-hidden bg-[radial-gradient(circle_at_50%_-20%,rgba(121,119,190,0.16),transparent_38%),#15191f] p-[15px] text-slate-100"
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
      <header className="flex h-[46px] items-center justify-between px-2 pb-1.5">
        <div className="flex min-w-0 items-center gap-[11px]">
          <button
            type="button"
            aria-label="返回首页"
            onClick={onBack}
            className="ui-icon-button grid size-[30px] place-items-center rounded-[10px] border border-white/10 text-slate-400"
          >
            <BackIcon />
          </button>
          <span className="grid size-[34px] place-items-center rounded-[11px] bg-[#34384a] text-lg">
            {project.icon}
          </span>
          <span className="min-w-0">
            <h1 className="truncate text-base font-semibold">
              {project.name}
            </h1>
            <span className="mt-0.5 block text-[10px] text-slate-500">
              {session.loadState.kind === 'ready'
                ? `${assetOperations.assets.length} 个 Asset`
                : '正在读取资料'}
            </span>
          </span>
        </div>
        <button
          type="button"
          aria-label="打开设置"
          onClick={onOpenSettings}
          className="ui-icon-button grid size-[30px] place-items-center rounded-[10px] border border-white/10 text-slate-400"
        >
          <SettingsIcon />
        </button>
      </header>

      <WorkbenchRuntimeProvider onError={setError}>
        <section className="grid h-[calc(100vh-76px)] min-h-[560px] grid-cols-[minmax(220px,2fr)_minmax(560px,6fr)_minmax(220px,2fr)] gap-3">
          <ProjectAssetPanel
            state={session.loadState}
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
            onExitSelectionMode={assetOperations.selection.exit}
            onToggleSelection={assetOperations.selection.toggle}
            onToggleAll={assetOperations.selection.toggleAll}
            onDeleteSelected={() => {
              if (
                assetOperations.selection.selectedAssets.length > 0
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
          <GenerationCenter
            asset={assetOperations.selectedAsset}
            mediaLabel={assetMediaLabel}
          />
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
