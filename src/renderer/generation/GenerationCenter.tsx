import { useCallback, useRef, useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import type {
  AssetPanelSelectionModel,
  AssetSelectionScope,
} from '../project/asset-panel-selection';
import { AssetPanel } from '../project/AssetPanel';
import type { AssetLoadState } from '../project/project-asset-view';
import { isWorkbenchActionEnabled } from '../workbench/actions/workbench-action';
import {
  useWorkbenchRuntime,
  useWorkbenchRuntimeSelector,
} from '../workbench/runtime/workbench-runtime-context';
import { MindMapGenerationDialog } from './MindMapGenerationDialog';
import type { MindMapGenerationDraft } from './mind-map-generation-draft';

export interface GenerationCenterProps {
  readonly projectId: string;
  readonly sourceAssets: readonly AssetSnapshot[];
  readonly asset: AssetSnapshot | undefined;
  readonly state: AssetLoadState;
  readonly selectedAssetId: string | null;
  readonly selection: AssetPanelSelectionModel;
  readonly busy: boolean;
  readonly now: number;
  readonly mediaLabel: (mediaType: string) => string;
  readonly onRetry: () => void;
  readonly onSelect: (assetId: string) => void;
  readonly onRemoveSelected: (
    scope: AssetSelectionScope,
    assets: readonly AssetSnapshot[],
  ) => void;
  readonly onRename: (asset: AssetSnapshot) => void;
  readonly onReveal: (asset: AssetSnapshot) => void;
  readonly onRelink: (asset: AssetSnapshot) => void;
  readonly onDelete: (asset: AssetSnapshot) => void;
  readonly onMindMapDraftReady?: (
    draft: MindMapGenerationDraft,
  ) => void;
}

const applicationTools = [
  {
    id: 'mind-map',
    label: '思维导图',
    description: '梳理主题与知识关系',
  },
  {
    id: 'study-outline',
    label: '学习提纲',
    description: '提炼章节与复习路径',
  },
  {
    id: 'flashcards',
    label: '知识卡片',
    description: '生成适合回顾的卡片',
  },
  {
    id: 'summary',
    label: '摘要',
    description: '形成跨资料重点摘要',
  },
] as const;

export function GenerationCenter({
  projectId,
  sourceAssets,
  asset,
  state,
  selectedAssetId,
  selection,
  busy,
  now,
  mediaLabel,
  onRetry,
  onSelect,
  onRemoveSelected,
  onRename,
  onReveal,
  onRelink,
  onDelete,
  onMindMapDraftReady,
}: GenerationCenterProps) {
  const [mindMapSourceAssets, setMindMapSourceAssets] = useState<
    readonly AssetSnapshot[] | null
  >(null);
  const mindMapButtonRef = useRef<HTMLButtonElement>(null);
  const runtime = useWorkbenchRuntime();
  const identity = useWorkbenchRuntimeSelector(
    (runtimeState) => runtimeState.identity,
  );
  const busyActionIds = useWorkbenchRuntimeSelector(
    (runtimeState) => runtimeState.busyActionIds,
  );
  const contributionRevision = useWorkbenchRuntimeSelector(
    (runtimeState) => runtimeState.contributionRevision,
  );
  const connected =
    asset !== undefined && identity?.assetId === asset.id;
  const tools = connected
    ? runtime
        .contributions('generation-center')
        .filter(
          (entry) =>
            entry.contribution.presentation.kind ===
            'generation-tool',
        )
    : [];
  void contributionRevision;

  const closeMindMapDialog = useCallback(() => {
    setMindMapSourceAssets(null);
    window.requestAnimationFrame(() => {
      mindMapButtonRef.current?.focus();
    });
  }, []);

  return (
    <>
      <AssetPanel
        id="project-generation-center"
        ariaLabel="生成中心"
        title="生成中心"
        state={state}
        countLabel={(count) => `${count} 个内容`}
        beforeListClassName="p-3.5 pb-0"
        beforeList={
          <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold text-slate-300">
              通用生成工具
            </p>
            <span className="text-[9px] text-slate-600">
              基于 Project 资料
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {applicationTools.map((tool) => {
              const isMindMap = tool.id === 'mind-map';
              const disabled = !isMindMap || sourceAssets.length === 0;

              return (
                <button
                  ref={isMindMap ? mindMapButtonRef : undefined}
                  key={tool.id}
                  type="button"
                  data-generation-tool={tool.id}
                  disabled={disabled}
                  title={
                    isMindMap
                      ? disabled
                        ? '请先在左侧选择资料'
                        : tool.description
                      : '生成能力尚未接入'
                  }
                  onClick={
                    isMindMap
                      ? () => {
                          if (sourceAssets.length > 0) {
                            setMindMapSourceAssets([...sourceAssets]);
                          }
                        }
                      : undefined
                  }
                  className="ui-control min-h-[76px] rounded-[11px] border border-white/[0.08] bg-indigo-300/[0.075] p-3 text-left hover:border-indigo-200/20 hover:bg-indigo-300/[0.12] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="block text-[11px] font-semibold text-slate-300">
                    {tool.label}
                  </span>
                  <span className="mt-1.5 block text-[9px] leading-4 text-slate-500">
                    {tool.description}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-5 text-[11px] font-semibold text-slate-300">
            当前 Asset 工具
          </p>
          <div className="mt-2 grid gap-1.5">
            {tools.map((entry) => {
              const presentation = entry.contribution.presentation;
              const actionBusy = busyActionIds.has(entry.action.id);
              const disabled =
                !isWorkbenchActionEnabled(entry.action) ||
                actionBusy;

              if (presentation.kind !== 'generation-tool') {
                return null;
              }

              return (
                <button
                  key={`${entry.ownerId}:${entry.contribution.id}`}
                  type="button"
                  disabled={disabled}
                  title={
                    disabled
                      ? presentation.disabledReason
                      : presentation.description
                  }
                  onClick={() => {
                    void runtime.invokeCurrent(
                      entry.action.id,
                      'generation-center',
                    );
                  }}
                  className="ui-control rounded-[10px] border border-white/[0.065] p-3 text-left disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="block text-[10px] font-medium text-slate-300">
                    {presentation.label}
                  </span>
                  <span className="mt-1 block text-[9px] leading-4 text-slate-600">
                    {presentation.description}
                  </span>
                </button>
              );
            })}
            {tools.length === 0 && (
              <p className="rounded-[10px] border border-white/[0.055] p-3 text-[10px] leading-5 text-slate-600">
                {!asset
                  ? '选择 Asset 后显示对应工具。'
                  : !connected
                    ? '正在装载当前资料工作台。'
                    : `当前 ${mediaLabel(asset.mediaType)} 工作台尚未提供专属工具。`}
              </p>
            )}
          </div>

          <div className="mt-5 h-px bg-white/[0.075]" />
          </>
        }
        listTitle="生成内容"
        listBodyClassName="px-3.5 pb-3.5"
        loadingLabel="正在加载生成内容…"
        failedLabel="生成内容加载失败"
        emptyState={
          <div className="rounded-[11px] border border-dashed border-white/[0.08] px-4 py-8 text-center">
            <p className="text-[10px] font-medium text-slate-400">
              还没有生成内容
            </p>
            <p className="mt-1.5 text-[9px] leading-4 text-slate-600">
              思维导图、讲义等生成结果会出现在这里
            </p>
          </div>
        }
        selection={selection}
        onRemoveSelected={onRemoveSelected}
        selectedAssetId={selectedAssetId}
        busy={busy}
        now={now}
        onRetry={onRetry}
        onSelect={onSelect}
        onRename={onRename}
        onReveal={onReveal}
        onRelink={onRelink}
        onDelete={onDelete}
      />
      {mindMapSourceAssets && (
        <MindMapGenerationDialog
          projectId={projectId}
          sourceAssets={mindMapSourceAssets}
          mediaLabel={mediaLabel}
          onClose={closeMindMapDialog}
          onSubmit={(draft) => {
            onMindMapDraftReady?.(draft);
            closeMindMapDialog();
          }}
        />
      )}
    </>
  );
}
