import { useCallback, useRef, useState } from 'react';

import type { AssetSnapshot } from '../../shared/assets';
import { userMessageFromError } from '../../shared/ipc-error';
import type { AssetSelectionScope } from '../project/asset-panel-selection';
import { useProjectAssetSelection } from '../project/asset-selection-context';
import { AssetPanel } from '../project/AssetPanel';
import type { AssetLoadState } from '../project/project-asset-view';
import { MindMapGenerationDialog } from './MindMapGenerationDialog';
import { GenerationTaskListItem } from './GenerationTaskListItem';
import type { MindMapGenerationDraft } from './mind-map-generation-draft';
import type { GenerationTaskPresentation } from './use-generation-tasks';
import { rendererGenerationTools } from '../../workbenches/catalog/register-renderer-workbenches';
import type {
  RendererGenerationToolDefinition,
  RendererGenerationToolResult,
} from './renderer-generation-tool';

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
  readonly onGenerationToolResult?: (
    result: RendererGenerationToolResult,
  ) => Promise<void> | void;
  readonly onError?: (message: string) => void;
}

const applicationTools = [
  {
    id: 'mind-map',
    label: '思维导图',
    description: '梳理主题与知识关系',
    order: 10,
  },
  {
    id: 'flashcards',
    label: '知识卡片',
    description: '生成适合回顾的卡片',
    order: 30,
  },
  {
    id: 'summary',
    label: '摘要',
    description: '形成跨资料重点摘要',
    order: 40,
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
  onGenerationToolResult,
  onError,
}: GenerationCenterProps) {
  const [mindMapSourceAssets, setMindMapSourceAssets] = useState<
    readonly AssetSnapshot[] | null
  >(null);
  const [activeSetupId, setActiveSetupId] = useState<string | null>(null);
  const [activatingToolId, setActivatingToolId] = useState<string | null>(null);
  const [pendingOpenResult, setPendingOpenResult] =
    useState<RendererGenerationToolResult | null>(null);
  const activationLockRef = useRef(false);
  const setupRequestIdRef = useRef<string | undefined>(undefined);
  const mindMapButtonRef = useRef<HTMLButtonElement>(null);
  const selectionCoordinator = useProjectAssetSelection();
  const sourceSelection = selectionCoordinator.imported;
  const generatedSelection = selectionCoordinator.generated;
  const tools = [...applicationTools, ...rendererGenerationTools].sort(
    (left, right) =>
      (left.order ?? Number.MAX_SAFE_INTEGER) -
      (right.order ?? Number.MAX_SAFE_INTEGER),
  );

  const activateWorkbenchTool = useCallback(
    async (
      tool: RendererGenerationToolDefinition,
      sourceAssets: readonly AssetSnapshot[],
      requestId?: string,
    ) => {
      if (activationLockRef.current) return;
      activationLockRef.current = true;
      setActivatingToolId(tool.id);
      try {
        const result = await tool.activate({
          projectId,
          sourceAssets,
          ...(requestId ? { requestId } : {}),
        });
        if (result) {
          setActiveSetupId(null);
          setupRequestIdRef.current = undefined;
          try {
            await onGenerationToolResult?.(result);
            setPendingOpenResult(null);
          } catch (error) {
            setPendingOpenResult(result);
            throw error;
          }
        } else {
          setupRequestIdRef.current = undefined;
        }
        setActiveSetupId(null);
      } catch (error: unknown) {
        onError?.(
          userMessageFromError(error, '无法创建生成内容。') ??
            '无法创建生成内容。',
        );
      } finally {
        activationLockRef.current = false;
        setActivatingToolId(null);
      }
    },
    [onError, onGenerationToolResult, projectId],
  );

  const retryPendingOpen = useCallback(async () => {
    const result = pendingOpenResult;
    if (!result || !onGenerationToolResult || activationLockRef.current) return;
    activationLockRef.current = true;
    setActivatingToolId('pending-open');
    try {
      await onGenerationToolResult(result);
      setPendingOpenResult(null);
    } catch (error: unknown) {
      onError?.(
        userMessageFromError(error, '仍无法打开已创建的生成内容。') ??
          '仍无法打开已创建的生成内容。',
      );
    } finally {
      activationLockRef.current = false;
      setActivatingToolId(null);
    }
  }, [onError, onGenerationToolResult, pendingOpenResult]);

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
              {tools.map((tool) => {
                const isMindMap = tool.id === 'mind-map';
                const workbenchTool = 'activate' in tool ? tool : undefined;
                const isWorkbenchTool = workbenchTool !== undefined;
                const hasSetup = workbenchTool?.setup !== undefined;
                const requiresSources = workbenchTool?.requiresSources === true;
                const disabled =
                  (!isMindMap && !isWorkbenchTool) || activatingToolId !== null;
                const candidateSelection = hasSetup
                  ? undefined
                  : workbenchTool?.sourceScope === 'generated'
                    ? generatedSelection
                    : sourceSelection;
                const sourceAssets =
                  candidateSelection?.selectedAssets.filter(
                    (asset) => workbenchTool?.acceptsSource?.(asset) ?? true,
                  ) ?? [];
                const sourceMissing =
                  !hasSetup &&
                  (isMindMap || requiresSources) &&
                  sourceAssets.length === 0;

                return (
                  <div key={tool.id} className="group relative">
                    <button
                      ref={isMindMap ? mindMapButtonRef : undefined}
                      type="button"
                      data-generation-tool={tool.id}
                      disabled={disabled}
                      aria-expanded={
                        hasSetup ? activeSetupId === tool.id : undefined
                      }
                      aria-describedby={
                        (isMindMap || requiresSources) && sourceMissing
                          ? `${tool.id}-source-tooltip`
                          : undefined
                      }
                      title={
                        isMindMap || isWorkbenchTool
                          ? sourceAssets.length > 0
                            ? tool.description
                            : undefined
                          : '生成能力尚未接入'
                      }
                      onClick={
                        isMindMap
                          ? () => {
                              if (sourceAssets.length === 0) {
                                candidateSelection?.enter();
                                onRevealSources();
                                return;
                              }

                              setMindMapSourceAssets([...sourceAssets]);
                            }
                          : isWorkbenchTool
                            ? () => {
                                if (hasSetup) {
                                  if (activeSetupId === tool.id) {
                                    setupRequestIdRef.current = undefined;
                                    setActiveSetupId(null);
                                  } else {
                                    setupRequestIdRef.current ??=
                                      crypto.randomUUID();
                                    setActiveSetupId(tool.id);
                                  }
                                  return;
                                }
                                if (sourceMissing) {
                                  candidateSelection?.enter();
                                  onRevealSources();
                                  return;
                                }
                                void activateWorkbenchTool(
                                  workbenchTool!,
                                  sourceAssets,
                                );
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
                    {(isMindMap || (requiresSources && !hasSetup)) &&
                      sourceMissing && (
                        <span
                          id={`${tool.id}-source-tooltip`}
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
            {(() => {
              const activeTool = tools.find(
                (tool) => tool.id === activeSetupId,
              );
              const Setup =
                activeTool && 'activate' in activeTool
                  ? activeTool.setup
                  : undefined;
              if (!Setup || !activeTool || !('activate' in activeTool))
                return null;
              return (
                <Setup
                  projectId={projectId}
                  candidateState={state}
                  onRetry={onRetry}
                  onComplete={(sourceAssets) => {
                    void activateWorkbenchTool(
                      activeTool,
                      sourceAssets,
                      setupRequestIdRef.current,
                    );
                  }}
                  onCancel={() => {
                    setupRequestIdRef.current = undefined;
                    setActiveSetupId(null);
                  }}
                />
              );
            })()}
            {pendingOpenResult && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-[10px] text-amber-100">
                <span className="min-w-0 flex-1">
                  内容已创建，但需求会话尚未打开。
                </span>
                <button
                  type="button"
                  disabled={activatingToolId !== null}
                  onClick={() => void retryPendingOpen()}
                  className="shrink-0 rounded-md border border-amber-200/25 px-2 py-1 hover:bg-amber-200/10 disabled:opacity-40"
                >
                  重新打开
                </button>
              </div>
            )}
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
