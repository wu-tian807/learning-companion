import { useCallback, useRef, useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import type { AssetSelectionScope } from '../project/asset-panel-selection';
import { useProjectAssetSelection } from '../project/asset-selection-context';
import { AssetPanel } from '../project/AssetPanel';
import type { AssetLoadState } from '../project/project-asset-view';
import { MindMapGenerationDialog } from './MindMapGenerationDialog';
import { GenerationTaskListItem } from './GenerationTaskListItem';
import type { MindMapGenerationDraft } from './mind-map-generation-draft';
import type { GenerationTaskPresentation } from './use-generation-tasks';

export interface GenerationCenterProps {
  readonly projectId: string;
  readonly state: AssetLoadState;
  readonly selectedAssetId: string | null;
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
  readonly onRevealSources: () => void;
  readonly onMindMapDraftReady?: (
    draft: MindMapGenerationDraft,
  ) => Promise<void> | void;
  readonly mindMapTasks?: readonly GenerationTaskPresentation[];
  readonly onRetryMindMapTask?: (taskId: string) => Promise<void> | void;
  readonly onCancelMindMapTask?: (taskId: string) => Promise<void> | void;
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
  state,
  selectedAssetId,
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
  onRevealSources,
  onMindMapDraftReady,
  mindMapTasks = [],
  onRetryMindMapTask,
  onCancelMindMapTask,
}: GenerationCenterProps) {
  const [mindMapSourceAssets, setMindMapSourceAssets] = useState<
    readonly AssetSnapshot[] | null
  >(null);
  const mindMapButtonRef = useRef<HTMLButtonElement>(null);
  const selectionCoordinator = useProjectAssetSelection();
  const sourceSelection = selectionCoordinator.imported;
  const generatedSelection = selectionCoordinator.generated;

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
              const disabled = !isMindMap;
              const sourceAssets = sourceSelection.selectedAssets;

              return (
                <div key={tool.id} className="group relative">
                  <button
                    ref={isMindMap ? mindMapButtonRef : undefined}
                    type="button"
                    data-generation-tool={tool.id}
                    disabled={disabled}
                    aria-describedby={
                      isMindMap && sourceAssets.length === 0
                        ? 'mind-map-source-tooltip'
                        : undefined
                    }
                    title={
                      isMindMap
                        ? sourceAssets.length > 0
                          ? tool.description
                          : undefined
                        : '生成能力尚未接入'
                    }
                    onClick={
                      isMindMap
                        ? () => {
                            if (sourceAssets.length === 0) {
                              sourceSelection.enter();
                              onRevealSources();
                              return;
                            }

                            setMindMapSourceAssets([...sourceAssets]);
                          }
                        : undefined
                    }
                    className="ui-control min-h-[76px] w-full rounded-[11px] border border-white/[0.08] bg-indigo-300/[0.075] p-3 text-left hover:border-indigo-200/20 hover:bg-indigo-300/[0.12] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="block text-[11px] font-semibold text-slate-300">
                      {tool.label}
                    </span>
                    <span className="mt-1.5 block text-[9px] leading-4 text-slate-500">
                      {tool.description}
                    </span>
                  </button>
                  {isMindMap && sourceAssets.length === 0 && (
                    <span
                      id="mind-map-source-tooltip"
                      role="tooltip"
                      className="pointer-events-none absolute top-[calc(100%-3px)] left-1/2 z-30 w-max -translate-x-1/2 rounded-md border border-white/10 bg-[#303640] px-2.5 py-1.5 text-[9px] font-medium text-slate-100 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      至少选择一个 Asset
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-5 h-px bg-white/[0.075]" />
          </>
        }
        listTitle="生成内容"
        listBodyClassName="px-3.5 pb-3.5"
        itemCount={
          (state.kind === 'ready' ? state.assets.length : 0) +
          mindMapTasks.length
        }
        listLeadingContent={
          !generatedSelection.active && mindMapTasks.length > 0
            ? mindMapTasks.map((presentation) => (
                <GenerationTaskListItem
                  key={presentation.task.id}
                  presentation={presentation}
                  now={now}
                  onRetry={onRetryMindMapTask}
                  onCancel={onCancelMindMapTask}
                />
              ))
            : undefined
        }
        loadingLabel="正在加载生成内容…"
        failedLabel="生成内容加载失败"
        emptyState={
          mindMapTasks.length > 0 ? null : (
            <div className="rounded-[11px] border border-dashed border-white/[0.08] px-4 py-8 text-center">
              <p className="text-[10px] font-medium text-slate-400">
                还没有生成内容
              </p>
              <p className="mt-1.5 text-[9px] leading-4 text-slate-600">
                思维导图、讲义等生成结果会出现在这里
              </p>
            </div>
          )
        }
        selection={generatedSelection}
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
          onSubmit={async (draft) => {
            await onMindMapDraftReady?.(draft);
            selectionCoordinator.clear();
            closeMindMapDialog();
          }}
        />
      )}
    </>
  );
}
