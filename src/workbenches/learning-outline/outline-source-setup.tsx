import { useEffect, useMemo, useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import { MIND_MAP_ASSET_MEDIA_TYPE } from '../../shared/asset-media-types';
import type { RendererGenerationToolSetupProps } from '../../renderer/generation/renderer-generation-tool';

function formatUpdatedTime(updatedTime: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(updatedTime);
}

export function LearningOutlineSourceSetup({
  candidateState,
  onRetry,
  onComplete,
  onCancel,
}: RendererGenerationToolSetupProps) {
  const [query, setQuery] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [selectionNotice, setSelectionNotice] = useState<string>();
  const candidates = useMemo(
    () =>
      candidateState.kind === 'ready'
        ? candidateState.assets.filter(
            (asset) => asset.mediaType === MIND_MAP_ASSET_MEDIA_TYPE,
          )
        : [],
    [candidateState],
  );
  const visibleCandidates = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return candidates;
    return candidates.filter((asset) =>
      asset.name.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [candidates, query]);
  const selectedAsset = candidates.find(
    (asset) => asset.id === selectedAssetId,
  );

  useEffect(() => {
    if (selectedAssetId && !selectedAsset) {
      setSelectedAssetId(undefined);
      setSelectionNotice('所选思维导图已不可用，请重新选择。');
    }
  }, [selectedAsset, selectedAssetId]);

  return (
    <section
      aria-label="选择思维导图"
      className="col-span-2 rounded-[11px] border border-indigo-300/20 bg-indigo-300/[0.06] p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-semibold text-indigo-100">
            选择思维导图
          </h3>
          <p className="mt-1 text-[9px] leading-4 text-slate-500">
            选择一份作为这份学习大纲的正式来源。
          </p>
        </div>
        <span className="text-[9px] text-slate-500">单选</span>
      </div>

      {candidateState.kind === 'loading' && (
        <p className="mt-3 rounded-lg border border-white/[0.07] px-3 py-4 text-center text-[10px] text-slate-500">
          正在读取思维导图…
        </p>
      )}
      {candidateState.kind === 'failed' && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-rose-300/20 bg-rose-300/[0.06] px-3 py-4 text-center text-[10px] text-rose-200"
        >
          <p>当前项目的生成内容读取失败。</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 rounded-md border border-rose-200/25 px-2.5 py-1 text-[9px] hover:bg-rose-200/10"
            >
              重试读取
            </button>
          )}
        </div>
      )}
      {candidateState.kind === 'ready' && candidates.length === 0 && (
        <p className="mt-3 rounded-lg border border-dashed border-white/[0.08] px-3 py-4 text-center text-[10px] text-slate-500">
          先创建一份思维导图，再开始学习大纲。
        </p>
      )}
      {candidateState.kind === 'ready' && candidates.length > 0 && (
        <>
          <label className="mt-3 block">
            <span className="sr-only">搜索思维导图</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索思维导图…"
              className="w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-[10px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-300/40"
            />
          </label>
          <div
            className="mt-2 max-h-44 space-y-1.5 overflow-y-auto"
            role="radiogroup"
            aria-label="思维导图列表"
          >
            {visibleCandidates.map((asset: AssetSnapshot) => {
              const selected = asset.id === selectedAssetId;
              return (
                <button
                  key={asset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setSelectionNotice(undefined);
                    setSelectedAssetId(asset.id);
                  }}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    selected
                      ? 'border-indigo-300/50 bg-indigo-300/15'
                      : 'border-white/[0.07] bg-white/[0.02] hover:border-indigo-200/25 hover:bg-white/[0.05]'
                  }`}
                >
                  <span className="block truncate text-[10px] font-medium text-slate-200">
                    {asset.name}
                  </span>
                  <span className="mt-1 block text-[9px] text-slate-500">
                    更新于 {formatUpdatedTime(asset.updatedTime)}
                  </span>
                </button>
              );
            })}
          </div>
          {visibleCandidates.length === 0 && (
            <p className="mt-2 text-[10px] text-slate-500">
              没有匹配的思维导图。
            </p>
          )}
        </>
      )}
      {selectionNotice && (
        <p role="status" className="mt-2 text-[10px] text-amber-200">
          {selectionNotice}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
        >
          取消
        </button>
        <button
          type="button"
          disabled={!selectedAsset}
          onClick={() => {
            if (selectedAsset) onComplete([selectedAsset]);
          }}
          className="rounded-lg bg-indigo-400/25 px-3 py-1.5 text-[10px] font-medium text-indigo-100 hover:bg-indigo-400/35 disabled:cursor-not-allowed disabled:opacity-40"
        >
          创建大纲并开始沟通
        </button>
      </div>
    </section>
  );
}
