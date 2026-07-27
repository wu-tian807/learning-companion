import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  isAssetSummary,
  isAssetSummaryList,
  type AddLocalAssetsResult,
  type AssetSummary,
  type ProjectSummary,
} from '../shared/ipc';
import {
  replaceAsset,
  selectAfterAssetDeletion,
  selectInitialAssetId,
} from './asset-view';

interface ProjectPageProps {
  readonly project: ProjectSummary;
  readonly onBack: () => void;
}

type AssetLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly assets: AssetSummary[] }
  | { readonly kind: 'failed' };

const availabilityLabels = {
  available: '可用',
  missing: '文件缺失',
  inaccessible: '无访问权限',
  invalid: '路径无效',
} as const;

const availabilityColors = {
  available: '#79a68e',
  missing: '#d49a6a',
  inaccessible: '#d17d86',
  invalid: '#8b93a2',
} as const;

function formatLastUsed(value: string): string {
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
    'application/pdf': 'PDF',
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

interface AssetActionsMenuProps {
  readonly asset: AssetSummary;
  readonly disabled: boolean;
  readonly onRename: () => void;
  readonly onRelink: () => void;
  readonly onRefresh: () => void;
  readonly onDelete: () => void;
}

function AssetActionsMenu({
  asset,
  disabled,
  onRename,
  onRelink,
  onRefresh,
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
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onRelink)}
            className="ui-menu-item block w-full rounded-lg px-3 py-2 text-left"
          >
            重新定位
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onRefresh)}
            className="ui-menu-item block w-full rounded-lg px-3 py-2 text-left"
          >
            刷新状态
          </button>
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
  readonly asset: AssetSummary;
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
  readonly dragging: boolean;
  readonly onSelect: (assetId: string) => void;
  readonly onAdd: () => void;
  readonly onRetry: () => void;
  readonly onRename: (asset: AssetSummary) => void;
  readonly onRelink: (asset: AssetSummary) => void;
  readonly onRefresh: (asset: AssetSummary) => void;
  readonly onDelete: (asset: AssetSummary) => void;
}

function AssetPanel({
  state,
  selectedAssetId,
  busy,
  dragging,
  onSelect,
  onAdd,
  onRetry,
  onRename,
  onRelink,
  onRefresh,
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

      <div className="flex shrink-0 items-center justify-between px-[17px] pt-3 pb-1.5 text-[10px] font-bold tracking-[0.09em] text-slate-500">
        <span>全部内容</span>
        <span className="text-[9px] font-medium tracking-normal text-slate-400/70">
          最近使用 ↓
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
              <span className="block truncate text-xs font-medium text-slate-200">
                {asset.name}
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                {mediaLabel(asset.mediaType)} · {formatLastUsed(asset.lastUsedTime)}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span
                className="size-1.5 rounded-full"
                title={availabilityLabels[asset.contentLocator.availability]}
                style={{
                  backgroundColor:
                    availabilityColors[asset.contentLocator.availability],
                }}
              />
              <AssetActionsMenu
                asset={asset}
                disabled={busy}
                onRename={() => onRename(asset)}
                onRelink={() => onRelink(asset)}
                onRefresh={() => onRefresh(asset)}
                onDelete={() => onDelete(asset)}
              />
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

interface ReaderPanelProps {
  readonly asset: AssetSummary | undefined;
  readonly onRelink: () => void;
  readonly onRefresh: () => void;
}

function ReaderPanel({ asset, onRelink, onRefresh }: ReaderPanelProps) {
  let content = (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <p className="text-sm font-medium text-slate-400">选择一份资料开始学习</p>
        <p className="mt-2 text-xs text-slate-600">阅读器会显示在这里</p>
      </div>
    </div>
  );

  if (asset) {
    const availability = asset.contentLocator.availability;

    if (availability === 'available') {
      content = (
        <div className="grid h-full place-items-center p-8 text-center">
          <div>
            <p className="text-sm font-medium text-slate-300">
              暂不支持渲染此类型
            </p>
            <p className="mt-2 max-w-lg truncate text-xs text-slate-600">
              {asset.contentLocator.path}
            </p>
          </div>
        </div>
      );
    } else {
      const messages = {
        missing: ['本地文件已移动或删除', '重新定位'],
        inaccessible: ['当前没有权限访问该文件', '刷新状态'],
        invalid: ['该路径不是可读取的普通文件', '重新定位'],
      } as const;
      const [message, action] = messages[availability];
      content = (
        <div className="grid h-full place-items-center p-8 text-center">
          <div>
            <p className="text-sm font-medium text-slate-300">{message}</p>
            <p className="mt-2 max-w-lg truncate text-xs text-slate-600">
              {asset.contentLocator.path}
            </p>
            <button
              type="button"
              onClick={availability === 'inaccessible' ? onRefresh : onRelink}
              className="ui-control mt-5 rounded-full border border-white/10 px-4 py-2 text-xs"
            >
              {action}
            </button>
          </div>
        </div>
      );
    }
  }

  return (
    <article
      aria-label="Asset 阅读器"
      className="flex min-w-0 flex-col overflow-hidden rounded-[17px] border border-white/[0.055] bg-[#1c2127] shadow-[0_20px_50px_rgba(5,8,12,0.16)]"
    >
      <div className="flex h-[54px] shrink-0 items-center justify-between gap-4 border-b border-white/[0.075] px-[17px]">
        <h2 className="truncate text-sm font-semibold text-slate-100">
          {asset?.name ?? '资料阅读器'}
        </h2>
        {asset && (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="rounded-lg border border-white/[0.08] px-2 py-1 text-[10px] text-slate-400">
              {mediaLabel(asset.mediaType)}
            </span>
            <button
              type="button"
              disabled
              aria-label="预览器操作"
              className="grid h-[26px] min-w-[30px] place-items-center rounded-lg border border-white/[0.08] px-2 text-xs tracking-[0.08em] text-slate-400"
            >
              •••
            </button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">{content}</div>
    </article>
  );
}

function GenerationPanel({ asset }: { readonly asset: AssetSummary | undefined }) {
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
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<AssetSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetSummary | null>(null);
  const mutationLockRef = useRef(false);

  useEffect(() => {
    let active = true;

    const open = async () => {
      try {
        const assets = await window.learningCompanion.openProject({
          projectId: project.id,
        });

        if (!isAssetSummaryList(assets)) {
          throw new Error('Project Asset 列表响应无效');
        }

        if (active) {
          setLoadState({ kind: 'ready', assets });
          setSelectedAssetId(selectInitialAssetId(assets));
        }
      } catch (loadError) {
        console.error('加载 Project Asset 失败', loadError);
        if (active) {
          setLoadState({ kind: 'failed' });
        }
      }
    };

    void open();

    return () => {
      active = false;
      void window.learningCompanion
        .closeProject({ projectId: project.id })
        .catch((closeError: unknown) => {
          console.error('卸载 Project Asset 失败', closeError);
        });
    };
  }, [project.id, requestVersion]);

  const assets = useMemo(
    () => (loadState.kind === 'ready' ? loadState.assets : []),
    [loadState],
  );
  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId),
    [assets, selectedAssetId],
  );

  const updateAssets = useCallback(
    (operation: (assets: AssetSummary[]) => AssetSummary[]) => {
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
        console.error(message, mutationError);
        setError(message);
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
        updateAssets((current) => [...current, ...result.added]);

        if (result.added[0]) {
          setSelectedAssetId(result.added[0].id);
        }
        if (result.failed.length > 0) {
          setError(
            `已添加 ${result.added.length} 项，${result.failed.length} 项失败：${result.failed[0]!.message}`,
          );
        }
      }, '添加资料失败，请重试。');
    },
    [runMutation, updateAssets],
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
      if (!isAssetSummary(updated)) {
        throw new Error('Asset 重命名响应无效');
      }
      updateAssets((current) => replaceAsset(current, updated));
    }, '无法保存 Asset 标题。');

    if (succeeded) {
      setRenameTarget(null);
    }
  };

  const relinkAsset = async (asset: AssetSummary) => {
    const [path] = await window.learningCompanion.selectLocalAssetFiles();
    if (!path) {
      return;
    }

    await runMutation(async () => {
      const updated = await window.learningCompanion.relinkAsset({
        assetId: asset.id,
        path,
      });
      if (!isAssetSummary(updated)) {
        throw new Error('Asset Relink 响应无效');
      }
      updateAssets((current) => replaceAsset(current, updated));
    }, '无法重新定位该 Asset。');
  };

  const refreshAsset = async (asset: AssetSummary) => {
    await runMutation(async () => {
      const updated = await window.learningCompanion.refreshAsset({
        assetId: asset.id,
      });
      if (!isAssetSummary(updated)) {
        throw new Error('Asset 刷新响应无效');
      }
      updateAssets((current) => replaceAsset(current, updated));
    }, '无法刷新文件状态。');
  };

  const deleteAsset = async () => {
    if (!deleteTarget) {
      return;
    }

    const target = deleteTarget;
    const succeeded = await runMutation(async () => {
      await window.learningCompanion.deleteAsset({ assetId: target.id });
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
        {error && (
          <div
            role="alert"
            className="flex max-w-xl items-center gap-3 rounded-full border border-rose-300/15 bg-rose-400/[0.07] px-4 py-2 text-[10px] text-rose-200"
          >
            <span className="truncate">{error}</span>
            <button type="button" onClick={() => setError(null)}>
              ×
            </button>
          </div>
        )}
      </header>

      <section className="grid h-[calc(100vh-76px)] min-h-[560px] grid-cols-[minmax(220px,2fr)_minmax(560px,6fr)_minmax(220px,2fr)] gap-3">
        <AssetPanel
          state={loadState}
          selectedAssetId={selectedAssetId}
          busy={busy}
          dragging={dragging}
          onSelect={setSelectedAssetId}
          onAdd={() => void chooseAndAdd()}
          onRetry={() => {
            setLoadState({ kind: 'loading' });
            setRequestVersion((current) => current + 1);
          }}
          onRename={setRenameTarget}
          onRelink={(asset) => void relinkAsset(asset)}
          onRefresh={(asset) => void refreshAsset(asset)}
          onDelete={setDeleteTarget}
        />
        <ReaderPanel
          asset={selectedAsset}
          onRelink={() => {
            if (selectedAsset) void relinkAsset(selectedAsset);
          }}
          onRefresh={() => {
            if (selectedAsset) void refreshAsset(selectedAsset);
          }}
        />
        <GenerationPanel asset={selectedAsset} />
      </section>

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
          onClose={() => !busy && setRenameTarget(null)}
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
                onClick={() => setDeleteTarget(null)}
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
    </main>
  );
}
