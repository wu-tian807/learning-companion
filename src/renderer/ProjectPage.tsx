import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  isAssetSnapshot,
  isAssetSnapshotList,
  type AssetSnapshot,
} from '../shared/assets';
import {
  isAddLocalAssetsResult,
  type AddLocalAssetsResult,
} from '../shared/ipc';
import { userMessageFromError } from '../shared/ipc-error';
import type { ProjectSnapshot } from '../shared/projects';
import type { WorkbenchSelectionEnvelope } from '../shared/workbench/selection';
import {
  replaceAsset,
  selectAfterAssetDeletion,
  selectInitialAssetId,
} from './asset-view';
import { ErrorDialog } from './components/ErrorDialog';
import { AssetWorkbenchHost } from './workbench/AssetWorkbenchHost';
import { reduceWorkbenchSelection } from './workbench/workbench-selection-state';
import { WorkbenchRuntimeProvider } from './workbench/runtime/WorkbenchRuntimeProvider';

interface ProjectPageProps {
  readonly project: ProjectSnapshot;
  readonly onBack: () => void;
}

type AssetLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly assets: AssetSnapshot[] }
  | { readonly kind: 'failed' };

const availabilityLabels = {
  available: '可用',
  missing: '文件缺失',
  inaccessible: '无访问权限',
  invalid: '路径无效',
} as const;

function formatLastUsed(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function mediaLabel(mediaType: string): string {
  const labels: Record<string, string> = {
    'application/epub+zip': 'EPUB',
    'application/octet-stream': '未知',
    'application/pdf': 'PDF',
    'image/bmp': 'BMP',
    'image/jpeg': 'JPEG',
    'image/png': 'PNG',
    'image/webp': 'WebP',
    'text/markdown': 'Markdown',
    'text/plain': '纯文本',
  };

  return labels[mediaType] ?? mediaType;
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

interface AssetActionsMenuProps {
  readonly asset: AssetSnapshot;
  readonly disabled: boolean;
  readonly onRename: () => void;
  readonly onReveal: () => void;
  readonly onRelink: () => void;
  readonly onDelete: () => void;
}

function AssetActionsMenu({
  asset,
  disabled,
  onRename,
  onReveal,
  onRelink,
  onDelete,
}: AssetActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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
        aria-label={`${asset.name} 的更多操作`}
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
          className="absolute top-8 right-0 z-30 w-36 rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 text-xs shadow-[0_18px_45px_rgba(0,0,0,0.42)]"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onRename)}
            className="ui-menu-item block w-full rounded-lg px-3 py-2 text-left"
          >
            编辑标题
          </button>
          {asset.contentRef.kind === 'local-file' &&
            asset.contentStatus.availability === 'available' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => run(onReveal)}
              className="ui-menu-item block w-full rounded-lg px-3 py-2 text-left"
            >
              在文件夹中显示
            </button>
          )}
          {asset.contentRef.kind === 'local-file' &&
            (asset.contentStatus.availability === 'missing' ||
              asset.contentStatus.availability === 'invalid') && (
            <button
              type="button"
              role="menuitem"
              onClick={() => run(onRelink)}
              className="ui-menu-item block w-full rounded-lg px-3 py-2 text-left"
            >
              重新定位
            </button>
          )}
          <div className="my-1 h-px bg-white/[0.08]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onDelete)}
            className="ui-menu-item ui-menu-item-danger block w-full rounded-lg px-3 py-2 text-left text-rose-300"
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}

interface RenameDialogProps {
  readonly asset: AssetSnapshot;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (name: string) => void;
}

function RenameDialog({
  asset,
  busy,
  error,
  onClose,
  onSubmit,
}: RenameDialogProps) {
  const [name, setName] = useState(asset.name);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]">
      <form
        className="w-full max-w-md rounded-[20px] border border-white/[0.12] bg-[#282d35] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(name);
        }}
      >
        <h2 className="text-lg font-semibold">编辑 Asset 标题</h2>
        <input
          autoFocus
          value={name}
          maxLength={160}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          className="mt-5 h-11 w-full rounded-xl border border-white/[0.12] bg-black/15 px-3 text-sm outline-none focus:border-indigo-300/45"
        />
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || name.trim().length === 0}
            className="ui-primary-button rounded-full bg-slate-50 px-5 py-2 text-xs font-semibold text-slate-900 disabled:opacity-40"
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface AssetPanelProps {
  readonly state: AssetLoadState;
  readonly selectedAssetId: string | null;
  readonly busy: boolean;
  readonly refreshingAll: boolean;
  readonly dragging: boolean;
  readonly onSelect: (assetId: string) => void;
  readonly onAdd: () => void;
  readonly onRetry: () => void;
  readonly onRename: (asset: AssetSnapshot) => void;
  readonly onReveal: (asset: AssetSnapshot) => void;
  readonly onRelink: (asset: AssetSnapshot) => void;
  readonly onRefreshAll: () => void;
  readonly onDelete: (asset: AssetSnapshot) => void;
}

function AssetPanel({
  state,
  selectedAssetId,
  busy,
  refreshingAll,
  dragging,
  onSelect,
  onAdd,
  onRetry,
  onRename,
  onReveal,
  onRelink,
  onRefreshAll,
  onDelete,
}: AssetPanelProps) {
  const assets = state.kind === 'ready' ? state.assets : [];

  return (
    <aside
      aria-label="Project Assets"
      className={[
        'flex min-w-0 flex-col overflow-hidden rounded-[17px] border bg-[#20252c] shadow-[0_20px_50px_rgba(5,8,12,0.16)] transition-colors',
        dragging
          ? 'border-indigo-300/45 bg-indigo-400/[0.08]'
          : 'border-white/[0.055]',
      ].join(' ')}
    >
      <div className="flex h-[54px] shrink-0 items-center justify-between border-b border-white/[0.075] px-[17px]">
        <h2 className="text-sm font-semibold text-slate-100">Assets</h2>
        <span className="text-[11px] text-slate-500">
          {state.kind === 'ready' ? `${assets.length} 项` : '—'}
        </span>
      </div>

      <button
        type="button"
        disabled={busy || state.kind !== 'ready'}
        onClick={onAdd}
        className="ui-control mx-3.5 mt-3.5 flex shrink-0 items-center justify-center gap-2 rounded-[11px] border border-dashed border-indigo-200/20 bg-indigo-400/[0.045] px-3 py-2.5 text-xs font-medium text-indigo-100/85 disabled:opacity-45"
      >
        <span aria-hidden="true">＋</span>
        添加资料
      </button>

      <div className="flex shrink-0 items-center justify-between px-[17px] pt-2.5 pb-1 text-[10px] font-bold tracking-[0.09em] text-slate-500">
        <span>全部内容</span>
        <span className="flex items-center gap-1.5">
          <span className="text-[9px] font-medium tracking-normal text-slate-400/70">
            最近使用 ↓
          </span>
          <button
            type="button"
            aria-label="刷新全部资料状态"
            title="刷新全部资料状态"
            disabled={busy || state.kind !== 'ready'}
            onClick={onRefreshAll}
            className="ui-icon-button grid size-7 place-items-center rounded-lg text-slate-400 disabled:opacity-40"
          >
            <RefreshIcon spinning={refreshingAll} />
          </button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {state.kind === 'loading' && (
          <p className="px-3 py-8 text-center text-xs text-slate-500">
            正在加载资料…
          </p>
        )}
        {state.kind === 'failed' && (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-rose-300">资料加载失败</p>
            <button
              type="button"
              onClick={onRetry}
              className="ui-control mt-3 rounded-full border border-white/10 px-3 py-1.5 text-[10px]"
            >
              重试
            </button>
          </div>
        )}
        {state.kind === 'ready' && assets.length === 0 && (
          <div className="px-3 py-10 text-center">
            <p className="text-xs font-medium text-slate-400">还没有资料</p>
            <p className="mt-2 text-[10px] leading-5 text-slate-600">
              点击添加资料，或将本地文件拖到这里
            </p>
          </div>
        )}
        {assets.map((asset) => (
          <div
            key={asset.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(asset.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(asset.id);
              }
            }}
            className={[
              'my-0.5 grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[11px] border p-2.5 text-left',
              asset.id === selectedAssetId
                ? 'border-indigo-300/15 bg-indigo-500/[0.12]'
                : 'border-transparent hover:bg-white/[0.035]',
            ].join(' ')}
          >
            <span className="grid size-[34px] place-items-center rounded-[9px] bg-white/[0.055] text-[10px] font-semibold text-slate-300">
              {mediaLabel(asset.mediaType).slice(0, 4)}
            </span>
            <span className="min-w-0">
              <span
                className={[
                  'block truncate text-xs font-medium',
                  asset.contentStatus.availability === 'available'
                    ? 'text-slate-200'
                    : 'text-red-400',
                ].join(' ')}
              >
                {asset.name}
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                {mediaLabel(asset.mediaType)} · {formatLastUsed(asset.lastUsedTime)}
              </span>
            </span>
            <span className="flex items-center gap-1">
              {asset.contentStatus.availability !== 'available' && (
                <span
                  className="size-1.5 rounded-full bg-red-400"
                  title={availabilityLabels[asset.contentStatus.availability]}
                  aria-label={availabilityLabels[asset.contentStatus.availability]}
                />
              )}
              <AssetActionsMenu
                asset={asset}
                disabled={busy}
                onRename={() => onRename(asset)}
                onReveal={() => onReveal(asset)}
                onRelink={() => onRelink(asset)}
                onDelete={() => onDelete(asset)}
              />
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function GenerationPanel({ asset }: { readonly asset: AssetSnapshot | undefined }) {
  return (
    <aside className="flex min-w-0 flex-col overflow-hidden rounded-[17px] border border-white/[0.055] bg-[#20252c] shadow-[0_20px_50px_rgba(5,8,12,0.16)]">
      <div className="flex h-[54px] items-center border-b border-white/[0.075] px-[17px]">
        <h2 className="text-sm font-semibold">生成中心</h2>
      </div>
      <div className="p-3.5">
        <p className="text-[11px] font-semibold text-slate-300">
          生成新的 Asset
        </p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {['思维导图', '学习提纲', '知识卡片', '摘要'].map((name) => (
            <button
              key={name}
              type="button"
              disabled
              className="min-h-[70px] rounded-[11px] border border-white/[0.07] bg-indigo-300/[0.07] p-2.5 text-left text-[10px] text-slate-400"
            >
              {name}
            </button>
          ))}
        </div>
        <p className="mt-5 text-[11px] font-semibold text-slate-300">
          当前 Asset 工具
        </p>
        <p className="mt-2 rounded-[10px] border border-white/[0.055] p-3 text-[10px] leading-5 text-slate-600">
          {asset
            ? `后续将为 ${mediaLabel(asset.mediaType)} 提供特定工具。`
            : '选择 Asset 后显示对应工具。'}
        </p>
      </div>
    </aside>
  );
}

export function ProjectPage({ project, onBack }: ProjectPageProps) {
  const [loadState, setLoadState] = useState<AssetLoadState>({
    kind: 'loading',
  });
  const [requestVersion, setRequestVersion] = useState(0);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<AssetSnapshot | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetSnapshot | null>(null);
  const [, setWorkbenchSelection] =
    useState<WorkbenchSelectionEnvelope>();
  const mutationLockRef = useRef(false);
  const projectLifecycleTaskRef = useRef<Promise<void>>(
    Promise.resolve(),
  );
  const workbenchLifecycleTaskRef = useRef<Promise<void>>(
    Promise.resolve(),
  );
  const handleWorkbenchLifecycleTask = useCallback(
    (task: Promise<void>) => {
      workbenchLifecycleTaskRef.current = task;
    },
    [],
  );
  const selectAsset = useCallback((assetId: string | null) => {
    setWorkbenchSelection(undefined);
    setSelectedAssetId(assetId);
  }, []);

  useEffect(() => {
    let active = true;
    const previousProjectLifecycle = projectLifecycleTaskRef.current;

    const open = async () => {
      try {
        await previousProjectLifecycle;

        if (!active) {
          return;
        }

        const assets = await window.learningCompanion.openProject({
          projectId: project.id,
        });

        if (!isAssetSnapshotList(assets)) {
          throw new Error('Project Asset 列表响应无效');
        }

        if (active) {
          setLoadState({ kind: 'ready', assets });
          selectAsset(selectInitialAssetId(assets));
        }
      } catch (loadError) {
        const message = userMessageFromError(
          loadError,
          '无法加载 Project 资料，请重试。',
        );

        if (!message) return;

        console.error('加载 Project Asset 失败', loadError);
        if (!active) return;

        setError(message);
        setLoadState({ kind: 'failed' });
      }
    };

    const openingTask = open();

    return () => {
      active = false;
      const workbenchLifecycleTask =
        workbenchLifecycleTaskRef.current;
      const closingTask = Promise.allSettled([
        openingTask,
        workbenchLifecycleTask,
      ])
        .then(() =>
          window.learningCompanion.closeProject({
            projectId: project.id,
          }),
        )
        .catch((closeError: unknown) => {
          const message = userMessageFromError(
            closeError,
            '无法正确关闭 Project。',
          );
          if (message) {
            console.error(message, closeError);
          }
        });
      projectLifecycleTaskRef.current = closingTask;
    };
  }, [project.id, requestVersion, selectAsset]);

  const assets = useMemo(
    () => (loadState.kind === 'ready' ? loadState.assets : []),
    [loadState],
  );
  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId),
    [assets, selectedAssetId],
  );
  const handleWorkbenchSelection = useCallback(
    (event: WorkbenchSelectionEnvelope) => {
      setWorkbenchSelection((current) =>
        reduceWorkbenchSelection(current, event, selectedAssetId ?? undefined),
      );
    },
    [selectedAssetId],
  );

  const updateAssets = useCallback(
    (operation: (assets: AssetSnapshot[]) => AssetSnapshot[]) => {
      setLoadState((current) =>
        current.kind === 'ready'
          ? { kind: 'ready', assets: operation(current.assets) }
          : current,
      );
    },
    [],
  );

  const runMutation = useCallback(
    async (operation: () => Promise<void>, message: string) => {
      if (mutationLockRef.current) {
        return false;
      }

      mutationLockRef.current = true;
      setBusy(true);
      setError(null);
      try {
        await operation();
        return true;
      } catch (mutationError) {
        const userMessage = userMessageFromError(mutationError, message);
        if (userMessage) {
          console.error(userMessage, mutationError);
          setError(userMessage);
        }
        return false;
      } finally {
        mutationLockRef.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const addPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) {
        return;
      }

      await runMutation(async () => {
        const result: AddLocalAssetsResult =
          await window.learningCompanion.addLocalAssets({ paths });

        if (!isAddLocalAssetsResult(result)) {
          throw new Error('批量添加 Asset 响应无效');
        }

        updateAssets((current) => [...current, ...result.added]);

        if (result.added[0]) {
          selectAsset(result.added[0].id);
        }
        if (result.failed.length > 0) {
          setError(
            `已添加 ${result.added.length} 项，${result.failed.length} 项失败：${result.failed[0]!.message}`,
          );
        }
      }, '添加资料失败，请重试。');
    },
    [runMutation, selectAsset, updateAssets],
  );

  const chooseAndAdd = async () => {
    const paths = await window.learningCompanion.selectLocalAssetFiles();
    await addPaths(paths);
  };

  const renameAsset = async (name: string) => {
    if (!renameTarget) {
      return;
    }

    const succeeded = await runMutation(async () => {
      const updated = await window.learningCompanion.renameAsset({
        assetId: renameTarget.id,
        name,
      });
      if (!isAssetSnapshot(updated)) {
        throw new Error('Asset 重命名响应无效');
      }
      updateAssets((current) => replaceAsset(current, updated));
    }, '无法保存 Asset 标题。');

    if (succeeded) {
      setRenameTarget(null);
    }
  };

  const relinkAsset = async (asset: AssetSnapshot) => {
    const [path] = await window.learningCompanion.selectLocalAssetFiles();
    if (!path) {
      return;
    }

    await runMutation(async () => {
      const updated = await window.learningCompanion.relinkAsset({
        assetId: asset.id,
        path,
      });
      if (!isAssetSnapshot(updated)) {
        throw new Error('Asset Relink 响应无效');
      }
      updateAssets((current) => replaceAsset(current, updated));
    }, '无法重新定位该 Asset。');
  };

  const revealAssetInFolder = async (asset: AssetSnapshot) => {
    await runMutation(
      () =>
        window.learningCompanion.revealAssetInFolder({
          assetId: asset.id,
        }),
      '无法在文件夹中显示该 Asset。',
    );
  };

  const refreshAsset = async (asset: AssetSnapshot) => {
    await runMutation(async () => {
      const updated = await window.learningCompanion.refreshAsset({
        assetId: asset.id,
      });
      if (!isAssetSnapshot(updated)) {
        throw new Error('Asset 刷新响应无效');
      }
      updateAssets((current) => replaceAsset(current, updated));
    }, '无法刷新文件状态。');
  };

  const refreshAllAssets = async () => {
    setRefreshingAll(true);
    try {
      await runMutation(async () => {
        const refreshed = await window.learningCompanion.refreshAllAssets({
          projectId: project.id,
        });
        if (!isAssetSnapshotList(refreshed)) {
          throw new Error('Asset 批量刷新响应无效');
        }
        setLoadState({ kind: 'ready', assets: refreshed });
      }, '无法刷新全部文件状态。');
    } finally {
      setRefreshingAll(false);
    }
  };

  const deleteAsset = async () => {
    if (!deleteTarget) {
      return;
    }

    const target = deleteTarget;
    const succeeded = await runMutation(async () => {
      await window.learningCompanion.deleteAsset({ assetId: target.id });
      setWorkbenchSelection(undefined);
      setSelectedAssetId((selected) =>
        selectAfterAssetDeletion(assets, target.id, selected),
      );
      updateAssets((current) =>
        current.filter((asset) => asset.id !== target.id),
      );
    }, '无法删除该 Asset。');

    if (succeeded) {
      setDeleteTarget(null);
    }
  };

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
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const paths = Array.from(event.dataTransfer.files)
          .map((file) => window.learningCompanion.getPathForFile(file))
          .filter((path) => path.length > 0);
        void addPaths(paths);
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
            <h1 className="truncate text-base font-semibold">{project.name}</h1>
            <span className="mt-0.5 block text-[10px] text-slate-500">
              {loadState.kind === 'ready'
                ? `${assets.length} 个 Asset`
                : '正在读取资料'}
            </span>
          </span>
        </div>
        <span title="设置功能即将开放">
          <button
            type="button"
            aria-label="设置（即将开放）"
            disabled
            className="ui-icon-button grid size-[30px] place-items-center rounded-[10px] border border-white/10 text-slate-500 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <SettingsIcon />
          </button>
        </span>
      </header>

      <WorkbenchRuntimeProvider onError={setError}>
        <section className="grid h-[calc(100vh-76px)] min-h-[560px] grid-cols-[minmax(220px,2fr)_minmax(560px,6fr)_minmax(220px,2fr)] gap-3">
          <AssetPanel
            state={loadState}
            selectedAssetId={selectedAssetId}
            busy={busy}
            refreshingAll={refreshingAll}
            dragging={dragging}
            onSelect={selectAsset}
            onAdd={() => void chooseAndAdd()}
            onRetry={() => {
              setLoadState({ kind: 'loading' });
              setRequestVersion((current) => current + 1);
            }}
            onRename={setRenameTarget}
            onReveal={(asset) => void revealAssetInFolder(asset)}
            onRelink={(asset) => void relinkAsset(asset)}
            onRefreshAll={() => void refreshAllAssets()}
            onDelete={setDeleteTarget}
          />
          <AssetWorkbenchHost
            projectId={project.id}
            asset={selectedAsset}
            mediaLabel={mediaLabel}
            onRelink={() => {
              if (selectedAsset) void relinkAsset(selectedAsset);
            }}
            onRefresh={() => {
              if (selectedAsset) void refreshAsset(selectedAsset);
            }}
            onReveal={() =>
              selectedAsset
                ? revealAssetInFolder(selectedAsset)
                : Promise.resolve()
            }
            onSelectionChange={handleWorkbenchSelection}
            onLifecycleTaskChange={handleWorkbenchLifecycleTask}
            onError={setError}
          />
          <GenerationPanel asset={selectedAsset} />
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

      {renameTarget && (
        <RenameDialog
          asset={renameTarget}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busy) {
              setRenameTarget(null);
              setError(null);
            }
          }}
          onSubmit={(name) => void renameAsset(name)}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-[20px] border border-white/[0.12] bg-[#282d35] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]">
            <h2 className="text-lg font-semibold">删除 Asset？</h2>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              “{deleteTarget.name}”将从当前 Project 中删除，本地原文件不会被删除。
            </p>
            {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDeleteTarget(null);
                  setError(null);
                }}
                className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void deleteAsset()}
                className="ui-danger-button rounded-full bg-rose-500 px-5 py-2 text-xs font-semibold"
              >
                {busy ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && !renameTarget && !deleteTarget && (
        <ErrorDialog message={error} onClose={() => setError(null)} />
      )}
    </main>
  );
}
