import { useEffect, useMemo, useRef, useState } from 'react';

import {
  assetFolderName,
  type AssetFolderSnapshot,
  type AssetFolderState,
} from '../../shared/asset-folders';
import type { AssetSnapshot } from '../../shared/assets';
import { AssetImportSplitButton } from '../components/AssetImportSplitButton';
import type { AssetSelectionScope } from './asset-panel-selection';
import { useAssetSelectionScope } from './asset-selection-context';
import {
  AssetFolderDeleteDialog,
  AssetFolderDestinationDialog,
  AssetFolderNameDialog,
} from './AssetFolderDialogs';
import {
  countAssetsInFolderTree,
  createAssetFolderBreadcrumbs,
  listAssetFolderDestinations,
  listDirectAssetFolders,
} from './asset-folder-view';
import { AssetPanel } from './AssetPanel';
import type { AssetLoadState } from './project-asset-view';

function RefreshIcon({ spinning = false }: { readonly spinning?: boolean }) {
  return (
    <svg
      className={['size-3.5', spinning ? 'animate-spin' : ''].join(' ')}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 7a6.5 6.5 0 1 0 .2 5.4" />
      <path d="M16 3v4h-4" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M2.8 5.5h5l1.6 1.8h7.8v7.2a1.5 1.5 0 0 1-1.5 1.5H4.3a1.5 1.5 0 0 1-1.5-1.5v-9Z" />
    </svg>
  );
}

interface FolderActionsMenuProps {
  readonly folder: AssetFolderSnapshot;
  readonly disabled: boolean;
  readonly onRename: () => void;
  readonly onMove: () => void;
  readonly onDelete: () => void;
}

function FolderActionsMenu({
  folder,
  disabled,
  onRename,
  onMove,
  onDelete,
}: FolderActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const run = (operation: () => void) => {
    setOpen(false);
    operation();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`${assetFolderName(folder.path)} 的更多操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className="ui-icon-button grid size-7 place-items-center rounded-lg text-xs tracking-widest text-slate-500 disabled:opacity-40"
      >
        •••
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-8 right-0 z-30 w-32 rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 text-xs shadow-[0_18px_45px_rgba(0,0,0,0.42)]"
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => run(onRename)} className="ui-menu-item block w-full rounded-lg px-3 py-2 text-left">
            重命名
          </button>
          <button type="button" role="menuitem" onClick={() => run(onMove)} className="ui-menu-item block w-full rounded-lg px-3 py-2 text-left">
            移动到…
          </button>
          <div className="my-1 h-px bg-white/[0.08]" />
          <button type="button" role="menuitem" onClick={() => run(onDelete)} className="ui-menu-item ui-menu-item-danger block w-full rounded-lg px-3 py-2 text-left text-rose-300">
            删除文件夹
          </button>
        </div>
      )}
    </div>
  );
}

type FolderDialogState =
  | { readonly kind: 'create' }
  | { readonly kind: 'rename'; readonly folder: AssetFolderSnapshot }
  | { readonly kind: 'move-folder'; readonly folder: AssetFolderSnapshot }
  | { readonly kind: 'move-assets'; readonly assets: readonly AssetSnapshot[] }
  | { readonly kind: 'delete'; readonly folder: AssetFolderSnapshot };

interface ProjectAssetPanelProps {
  readonly state: AssetLoadState;
  readonly folderState: AssetFolderState | null;
  readonly currentFolderPath: string | null;
  readonly selectedAssetId: string | null;
  readonly busy: boolean;
  readonly refreshingAll: boolean;
  readonly dragging: boolean;
  readonly now: number;
  readonly onSelect: (assetId: string) => void;
  readonly onRemoveSelected: (scope: AssetSelectionScope, assets: readonly AssetSnapshot[]) => void;
  readonly onCopyAdd: () => void;
  readonly onLinkAdd: () => void;
  readonly onRetry: () => void;
  readonly onOpenFolder: (path: string | null) => void;
  readonly onCreateFolder: (name: string) => Promise<boolean>;
  readonly onRenameFolder: (folder: AssetFolderSnapshot, name: string) => Promise<boolean>;
  readonly onMoveFolder: (folder: AssetFolderSnapshot, parentPath: string | null) => Promise<boolean>;
  readonly onDeleteFolder: (folder: AssetFolderSnapshot) => Promise<boolean>;
  readonly onMoveAssets: (assets: readonly AssetSnapshot[], folderPath: string | null) => Promise<boolean>;
  readonly onRename: (asset: AssetSnapshot) => void;
  readonly onReveal: (asset: AssetSnapshot) => void;
  readonly onRelink: (asset: AssetSnapshot) => void;
  readonly onRefreshAll: () => void;
  readonly onDelete: (asset: AssetSnapshot) => void;
}

export function ProjectAssetPanel({
  state,
  folderState,
  currentFolderPath,
  selectedAssetId,
  busy,
  refreshingAll,
  dragging,
  now,
  onSelect,
  onRemoveSelected,
  onCopyAdd,
  onLinkAdd,
  onRetry,
  onOpenFolder,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onMoveAssets,
  onRename,
  onReveal,
  onRelink,
  onRefreshAll,
  onDelete,
}: ProjectAssetPanelProps) {
  const selection = useAssetSelectionScope('imported');
  const [dialog, setDialog] = useState<FolderDialogState | null>(null);
  const directFolders = useMemo(
    () => listDirectAssetFolders(folderState?.folders ?? [], currentFolderPath),
    [currentFolderPath, folderState],
  );
  const breadcrumbs = createAssetFolderBreadcrumbs(currentFolderPath);
  const visibleAssetCount = state.kind === 'ready' ? state.assets.length : 0;
  const closeDialog = () => {
    if (!busy) setDialog(null);
  };

  return (
    <>
      <AssetPanel
        id="project-assets-panel"
        ariaLabel="Project Assets"
        title="Assets"
        state={state}
        highlighted={dragging}
        itemCount={directFolders.length + visibleAssetCount}
        toolbar={<AssetImportSplitButton disabled={busy || state.kind !== 'ready'} onCopy={onCopyAdd} onLink={onLinkAdd} />}
        listTitle={
          <nav aria-label="资料文件夹路径" className="flex min-w-0 items-center gap-1">
            {breadcrumbs.map((breadcrumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <span key={breadcrumb.path ?? 'root'} className="flex min-w-0 items-center gap-1">
                  {index > 0 && <span className="text-slate-700">/</span>}
                  {last ? (
                    <span className="truncate text-slate-400">{breadcrumb.label}</span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => onOpenFolder(breadcrumb.path)} className="ui-control max-w-20 truncate rounded px-1 py-0.5 text-slate-500">
                      {breadcrumb.label}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
        }
        listAction={
          <>
            <button type="button" aria-label="新建资料文件夹" title="新建资料文件夹" disabled={busy || state.kind !== 'ready'} onClick={() => setDialog({ kind: 'create' })} className="ui-icon-button grid size-7 place-items-center rounded-lg text-base text-slate-400 disabled:opacity-40">
              +
            </button>
            <button type="button" aria-label="刷新全部资料状态" title="刷新全部资料状态" disabled={busy || state.kind !== 'ready'} onClick={onRefreshAll} className="ui-icon-button grid size-7 place-items-center rounded-lg text-slate-400 disabled:opacity-40">
              <RefreshIcon spinning={refreshingAll} />
            </button>
          </>
        }
        listLeadingContent={directFolders.map((folder) => (
          <div
            key={folder.path}
            className="my-0.5 grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-[11px] border border-transparent p-1.5"
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenFolder(folder.path)}
              className="grid min-w-0 grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5 rounded-lg p-1 text-left hover:bg-white/[0.035] disabled:opacity-50"
            >
              <span className="grid size-[34px] place-items-center rounded-[9px] bg-amber-300/[0.09] text-amber-200/75">
                <FolderIcon />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-slate-200">
                  {assetFolderName(folder.path)}
                </span>
                <span className="mt-0.5 block text-[10px] text-slate-500">
                  {folderState
                    ? countAssetsInFolderTree(folderState, folder.path)
                    : 0}{' '}
                  份资料
                </span>
              </span>
            </button>
            <FolderActionsMenu
              folder={folder}
              disabled={busy}
              onRename={() => setDialog({ kind: 'rename', folder })}
              onMove={() => setDialog({ kind: 'move-folder', folder })}
              onDelete={() => setDialog({ kind: 'delete', folder })}
            />
          </div>
        ))}
        loadingLabel="正在加载资料…"
        failedLabel="资料加载失败"
        emptyState={
          <div className="px-3 py-8 text-center">
            <p className="text-xs font-medium text-slate-400">{directFolders.length > 0 ? '没有直属资料' : '这个文件夹还是空的'}</p>
            <p className="mt-2 text-[10px] leading-5 text-slate-600">点击添加资料，或将本地文件拖到这里</p>
          </div>
        }
        selection={selection}
        onMoveSelected={(assets) => setDialog({ kind: 'move-assets', assets })}
        onRemoveSelected={onRemoveSelected}
        selectedAssetId={selectedAssetId}
        busy={busy}
        now={now}
        onRetry={onRetry}
        onSelect={onSelect}
        onMove={(asset) => setDialog({ kind: 'move-assets', assets: [asset] })}
        onRename={onRename}
        onReveal={onReveal}
        onRelink={onRelink}
        onDelete={onDelete}
      />

      {dialog?.kind === 'create' && <AssetFolderNameDialog title="新建资料文件夹" busy={busy} onClose={closeDialog} onSubmit={onCreateFolder} />}
      {dialog?.kind === 'rename' && (
        <AssetFolderNameDialog title="重命名资料文件夹" initialName={assetFolderName(dialog.folder.path)} busy={busy} onClose={closeDialog} onSubmit={(name) => onRenameFolder(dialog.folder, name)} />
      )}
      {dialog?.kind === 'move-folder' && folderState && (
        <AssetFolderDestinationDialog
          title={`移动“${assetFolderName(dialog.folder.path)}”`}
          description="选择新的上级文件夹。文件夹中的资料不会移动真实文件。"
          destinations={listAssetFolderDestinations(folderState.folders, dialog.folder.path)}
          busy={busy}
          onClose={closeDialog}
          onSubmit={(path) => onMoveFolder(dialog.folder, path)}
        />
      )}
      {dialog?.kind === 'move-assets' && folderState && (
        <AssetFolderDestinationDialog
          title={`移动 ${dialog.assets.length} 份资料`}
          description="这里只会更改 Project 内的分类，不会移动本地原文件。"
          destinations={listAssetFolderDestinations(folderState.folders)}
          busy={busy}
          onClose={closeDialog}
          onSubmit={(path) => onMoveAssets(dialog.assets, path)}
        />
      )}
      {dialog?.kind === 'delete' && folderState && (
        <AssetFolderDeleteDialog
          folderName={assetFolderName(dialog.folder.path)}
          assetCount={countAssetsInFolderTree(folderState, dialog.folder.path)}
          busy={busy}
          onClose={closeDialog}
          onConfirm={() => onDeleteFolder(dialog.folder)}
        />
      )}
    </>
  );
}
