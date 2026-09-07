import { useMemo, useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import { userMessageFromError } from '../../shared/ipc-error';
import { AssetWorkbenchHost } from '../workbench/host/AssetWorkbenchHost';
import { WorkbenchRuntimeProvider } from '../workbench/runtime/WorkbenchRuntimeProvider';
import { useProjectNotebook } from './use-project-notebook';

export function ProjectNotebookPanel({
  active,
  projectReady,
  projectId,
  assets,
  onSelectMaterialAsset,
  onOpenWorkbenchLocation,
  onLifecycleTaskChange,
  onError,
}: {
  readonly active: boolean;
  readonly projectReady: boolean;
  readonly projectId: string;
  readonly assets: readonly AssetSnapshot[];
  readonly onSelectMaterialAsset: (assetId: string) => Promise<void> | void;
  readonly onOpenWorkbenchLocation: (href: string) => Promise<void>;
  readonly onLifecycleTaskChange: (task: Promise<void>) => void;
  readonly onError: (message: string) => void;
}) {
  const notebook = useProjectNotebook(projectId, active && projectReady);
  const [newName, setNewName] = useState('新建笔记');
  const markdownAssets = useMemo(
    () => assets.filter((asset) => asset.mediaType === 'text/markdown'),
    [assets],
  );
  const selectedId =
    notebook.state.kind === 'ready' ? notebook.state.snapshot.assetId : undefined;
  const selectedAsset = markdownAssets.find((asset) => asset.id === selectedId);

  const create = () => {
    void notebook.create(newName).catch((error) => {
      onError(userMessageFromError(error, '无法新建笔记。') ?? '无法新建笔记。');
    });
  };
  const select = (assetId: string) => {
    void notebook.select(assetId).catch((error) => {
      onError(userMessageFromError(error, '无法打开该 Markdown 笔记。') ?? '无法打开该 Markdown 笔记。');
    });
  };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-[17px] border border-white/10 bg-[#20242b] shadow-xl">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/8 px-3 py-2">
        <h2 className="mr-auto text-sm font-semibold text-slate-100">项目笔记</h2>
        <select
          aria-label="打开已有 Markdown 笔记"
          value={selectedId ?? ''}
          onChange={(event) => {
            if (event.target.value) select(event.target.value);
          }}
          className="ui-control max-w-36 rounded-md border border-white/10 bg-[#1b2027] px-2 py-1 text-xs text-slate-200"
        >
          <option value="">打开已有 Markdown</option>
          {markdownAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>{asset.name}</option>
          ))}
        </select>
      </header>
      <div className="flex shrink-0 gap-2 border-b border-white/8 px-3 py-2">
        <input
          aria-label="新建笔记名称"
          value={newName}
          maxLength={160}
          onChange={(event) => setNewName(event.target.value)}
          className="ui-control min-w-0 flex-1 rounded-md border border-white/10 bg-[#1b2027] px-2 py-1 text-xs text-slate-200"
        />
        <button
          type="button"
          disabled={!projectReady || notebook.creating || !newName.trim()}
          onClick={create}
          className="ui-control rounded-md border border-indigo-300/30 px-2 py-1 text-xs text-indigo-100 disabled:opacity-40"
        >
          {notebook.creating ? '正在新建…' : '新建笔记'}
        </button>
      </div>
      {notebook.state.kind === 'idle' || notebook.state.kind === 'loading' ? (
        <div className="grid flex-1 place-items-center text-xs text-slate-500">正在读取笔记…</div>
      ) : notebook.state.kind === 'error' ? (
        <div className="grid flex-1 place-items-center gap-3 p-5 text-xs text-rose-200">
          <p>{notebook.state.message}</p>
          <button type="button" onClick={() => void notebook.retry()} className="rounded border border-white/10 px-2 py-1 text-slate-200">重试</button>
        </div>
      ) : !selectedAsset ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-xs text-slate-500">
          <p>新建一篇笔记，或打开当前 Project 中已有的 Markdown Asset。</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 p-2">
          {active && (
            <WorkbenchRuntimeProvider onError={onError}>
              <AssetWorkbenchHost
                projectId={projectId}
                viewportId="project-notebook"
                asset={selectedAsset}
                mediaLabel={() => 'Markdown'}
                onRelink={() => undefined}
                onRefresh={() => undefined}
                onReveal={() => Promise.resolve()}
                onSelectAsset={onSelectMaterialAsset}
                onOpenWorkbenchLocation={onOpenWorkbenchLocation}
                onOpenSettings={() => undefined}
                onLifecycleTaskChange={onLifecycleTaskChange}
                onError={onError}
              />
            </WorkbenchRuntimeProvider>
          )}
        </div>
      )}
    </aside>
  );
}
