import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { registerWorkbenchTargetController } from '../../renderer/workbench/host/workbench-target-bridge';
import { useWorkbenchContributions } from '../../renderer/workbench/runtime/use-workbench-contributions';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
import { userMessageFromError } from '../../shared/ipc-error';
import { EMPTY_WORKBENCH_INTERACTION } from '../../shared/workbench/interaction';
import type { AssetTarget } from '../../shared/workbench/asset-target';
import type { MindMapWorkbenchPayload } from './shared';
import {
  cloneMindMapWorkbenchViewState,
  createMindMapNodeTarget,
  createMindMapSaveViewStateCommand,
  isMindMapSaveViewStateResult,
  isMindMapNodeTarget,
  isMindMapWorkbenchPayload,
  MIND_MAP_WORKBENCH_ID,
  mindMapWorkbenchManifest,
  type MindMapWorkbenchViewStateV1,
} from './shared';
import {
  createMindMapLayout,
} from './layout';
import { createMindMapRendererActions } from './renderer-actions';
import { mindMapEdgeTypes } from './renderer-edge';
import { resolveMindMapTargetNavigation } from './target-navigation';
import {
  createMindMapFlowEdges,
  createMindMapFlowNodes,
  type MindMapFlowEdge,
} from './renderer-flow-model';
import {
  createMindMapExpandAllGrowthWave,
  createMindMapNodeGrowthWave,
  type MindMapGrowthWave,
} from './renderer-growth';
import {
  mindMapNodeTypes,
  type MindMapFlowNode,
} from './renderer-node';
import {
  MIND_MAP_RENDERER_STYLES,
  MindMapRendererOverlays,
} from './renderer-overlays';
import {
  collapseMindMapNode,
  expandMindMapNodeOneLevel,
  toggleMindMapNode,
} from './view-state';

interface MindMapCanvasProps extends RendererWorkbenchViewProps {
  readonly payload: MindMapWorkbenchPayload;
}

function MindMapCanvas({
  asset,
  bootstrap,
  executeCommand,
  onInteractionChange,
  onReveal,
  onError,
  payload,
}: MindMapCanvasProps) {
  const runtime = useWorkbenchRuntime();
  const flowRef = useRef<
    ReactFlowInstance<MindMapFlowNode, MindMapFlowEdge> | undefined
  >(undefined);
  const latestViewStateRef = useRef<MindMapWorkbenchViewStateV1>(
    cloneMindMapWorkbenchViewState(payload.viewState),
  );
  const [viewState, setViewState] = useState<MindMapWorkbenchViewStateV1>(
    latestViewStateRef.current,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [growthWave, setGrowthWave] = useState<MindMapGrowthWave>();
  const growthTimerRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  const beginGrowthWave = useCallback(
    (wave: MindMapGrowthWave | undefined) => {
      if (growthTimerRef.current !== undefined) {
        clearTimeout(growthTimerRef.current);
      }

      setGrowthWave(wave);

      if (wave) {
        growthTimerRef.current = setTimeout(() => {
          setGrowthWave((current) =>
            current === wave ? undefined : current,
          );
          growthTimerRef.current = undefined;
        }, wave.lifetimeMs);
      } else {
        growthTimerRef.current = undefined;
      }
    },
    [],
  );

  useEffect(
    () => () => {
      if (growthTimerRef.current !== undefined) {
        clearTimeout(growthTimerRef.current);
      }
    },
    [],
  );

  const reportError = useCallback(
    (error: unknown, fallback: string) => {
      const message = userMessageFromError(error, fallback);

      if (message) {
        console.error(message, error);
        onError(message);
      }
    },
    [onError],
  );

  const persistViewState = useCallback(
    async (nextState: MindMapWorkbenchViewStateV1) => {
      try {
        const result = await executeCommand(
          createMindMapSaveViewStateCommand(nextState),
        );

        if (!isMindMapSaveViewStateResult(result.payload)) {
          throw new Error('Mind Map Workbench 视图状态响应无效');
        }
      } catch (error) {
        reportError(error, '无法保存思维导图视图状态。');
      }
    },
    [executeCommand, reportError],
  );

  const commitViewState = useCallback(
    (nextState: MindMapWorkbenchViewStateV1) => {
      const normalized = cloneMindMapWorkbenchViewState(nextState);
      latestViewStateRef.current = normalized;
      setViewState(normalized);
      void persistViewState(normalized);
    },
    [persistViewState],
  );

  const selectNode = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      onInteractionChange({
        focus: createMindMapNodeTarget(nodeId),
        inputs: [],
      });
    },
    [onInteractionChange],
  );

  const updateNodeViewState = useCallback(
    (
      nodeId: string,
      transition: typeof collapseMindMapNode,
    ) => {
      const current = latestViewStateRef.current;
      const next = transition(payload.document, current, nodeId);

      if (next !== current) {
        commitViewState(next);
      }
    },
    [commitViewState, payload.document],
  );

  const expandNode = useCallback(
    (nodeId: string) => {
      const current = latestViewStateRef.current;
      const next = expandMindMapNodeOneLevel(
        payload.document,
        current,
        nodeId,
      );

      if (next !== current) {
        beginGrowthWave(
          createMindMapNodeGrowthWave(payload.document, nodeId),
        );
        commitViewState(next);
      }
    },
    [beginGrowthWave, commitViewState, payload.document],
  );

  const collapseNode = useCallback(
    (nodeId: string) => {
      updateNodeViewState(nodeId, collapseMindMapNode);
    },
    [updateNodeViewState],
  );

  const toggleNode = useCallback(
    (nodeId: string) => {
      if (latestViewStateRef.current.collapsedNodeIds.includes(nodeId)) {
        expandNode(nodeId);
      } else {
        updateNodeViewState(nodeId, toggleMindMapNode);
      }
    },
    [expandNode, updateNodeViewState],
  );

  const expandAll = useCallback(() => {
    const current = latestViewStateRef.current;

    if (current.collapsedNodeIds.length === 0) {
      return;
    }

    beginGrowthWave(
      createMindMapExpandAllGrowthWave(
        payload.document,
        new Set(current.collapsedNodeIds),
      ),
    );
    commitViewState({
      collapsedNodeIds: [],
      ...(current.viewport
        ? { viewport: current.viewport }
        : {}),
    });
  }, [beginGrowthWave, commitViewState, payload.document]);

  const fit = useCallback(() => {
    void flowRef.current?.fitView({
      padding: 0.24,
      duration: 240,
      maxZoom: 1.15,
    });
  }, []);

  const revealTarget = useCallback((target: AssetTarget): boolean => {
    if (target.scope !== 'content') return false;
    const navigation = resolveMindMapTargetNavigation(
      payload.document,
      target,
    );
    if (!navigation) return false;
    const current = latestViewStateRef.current;
    const collapsedNodeIds = current.collapsedNodeIds.filter(
      (nodeId) => !navigation.visibleNodeIds.includes(nodeId),
    );
    if (collapsedNodeIds.length !== current.collapsedNodeIds.length) {
      commitViewState({
        ...current,
        collapsedNodeIds,
      });
    }

    if (navigation.selectedNodeId) {
      setSelectedNodeId(navigation.selectedNodeId);
    }
    onInteractionChange({ focus: target, inputs: [] });
    window.requestAnimationFrame(() => {
      void flowRef.current?.fitView({
        nodes: navigation.nodeIds.map((id) => ({ id })),
        padding: 0.4,
        duration: 240,
        maxZoom: 1.3,
      });
    });
    return true;
  }, [commitViewState, onInteractionChange, payload.document]);

  useEffect(() => registerWorkbenchTargetController(
    `${mindMapWorkbenchManifest.id}:${bootstrap.sessionId}.targets`,
    asset.id,
    {
      sourceRevision: payload.revision,
      reveal: revealTarget,
    },
  ), [asset.id, bootstrap.sessionId, payload.revision, revealTarget]);

  const reveal = useCallback(async () => {
    try {
      await onReveal();
    } catch (error) {
      reportError(error, '无法在文件夹中显示思维导图。');
    }
  }, [onReveal, reportError]);

  const rendererActions = useMemo(
    () =>
      createMindMapRendererActions({
        canToggleFocusedNode: () => {
          const focus = runtime.interactionContext()?.focus;

          return Boolean(
            isMindMapNodeTarget(focus) &&
              payload.document.nodes[focus.targetPayload.nodeId]
                ?.childIds.length,
          );
        },
        hasCollapsedNodes: () =>
          latestViewStateRef.current.collapsedNodeIds.length > 0,
        onFit: fit,
        onToggleNode: toggleNode,
        onExpandAll: expandAll,
        onReveal: reveal,
      }),
    [expandAll, fit, payload.document.nodes, reveal, runtime, toggleNode],
  );
  useWorkbenchContributions(MIND_MAP_WORKBENCH_ID, rendererActions);

  const layout = useMemo(
    () =>
      createMindMapLayout(
        payload.document,
        new Set(viewState.collapsedNodeIds),
      ),
    [payload.document, viewState.collapsedNodeIds],
  );
  const nodes = useMemo<readonly MindMapFlowNode[]>(
    () =>
      createMindMapFlowNodes({
        layout,
        rootNodeId: payload.document.rootNodeId,
        associations: payload.associations,
        selectedNodeId,
        growthDelayByNodeId: growthWave?.nodeDelayById,
        onSelectAndCollapse: (nodeId) => {
          selectNode(nodeId);
          collapseNode(nodeId);
        },
      }),
    [
      layout.nodes,
      payload.associations,
      payload.document.rootNodeId,
      growthWave,
      collapseNode,
      selectNode,
      selectedNodeId,
    ],
  );
  const edges = useMemo<readonly MindMapFlowEdge[]>(
    () =>
      createMindMapFlowEdges(
        layout,
        growthWave?.edgeDelayById,
      ),
    [growthWave, layout],
  );

  const openNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: MindMapFlowNode) => {
      event.preventDefault();
      event.stopPropagation();
      const interaction = {
        focus: createMindMapNodeTarget(node.id),
        inputs: [],
      } as const;
      setSelectedNodeId(node.id);
      onInteractionChange(interaction);
      runtime.openContextMenu(
        bootstrap.sessionId,
        { x: event.clientX, y: event.clientY },
        interaction,
      );
    },
    [bootstrap.sessionId, onInteractionChange, runtime],
  );

  const openPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      setSelectedNodeId(undefined);
      onInteractionChange(EMPTY_WORKBENCH_INTERACTION);
      runtime.openContextMenu(
        bootstrap.sessionId,
        { x: event.clientX, y: event.clientY },
        EMPTY_WORKBENCH_INTERACTION,
      );
    },
    [bootstrap.sessionId, onInteractionChange, runtime],
  );

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      const current = latestViewStateRef.current;

      if (
        current.viewport?.x === viewport.x &&
        current.viewport.y === viewport.y &&
        current.viewport.zoom === viewport.zoom
      ) {
        return;
      }

      commitViewState({
        collapsedNodeIds: current.collapsedNodeIds,
        viewport,
      });
    },
    [commitViewState],
  );

  const defaultViewport = viewState.viewport ?? {
    x: 0,
    y: 0,
    zoom: 1,
  };
  const staleCount = payload.associations.staleBindings.length;

  return (
    <div
      tabIndex={0}
      aria-label="Mind Map 工作台"
      className="learning-mindmap-workbench relative h-full min-h-0 overflow-hidden bg-[#11161c] outline-none"
      onPointerDown={(event) => event.currentTarget.focus()}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === '0') {
          event.preventDefault();
          fit();
        }
      }}
    >
      <style>{MIND_MAP_RENDERER_STYLES}</style>
      <ReactFlow<MindMapFlowNode, MindMapFlowEdge>
        nodes={[...nodes]}
        edges={[...edges]}
        nodeTypes={mindMapNodeTypes}
        edgeTypes={mindMapEdgeTypes}
        defaultViewport={defaultViewport}
        fitView={viewState.viewport === undefined}
        fitViewOptions={{ padding: 0.24, maxZoom: 1.15 }}
        minZoom={0.18}
        maxZoom={2.2}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable
        selectNodesOnDrag={false}
        panOnScroll
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        onlyRenderVisibleElements
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => {
          flowRef.current = instance;
        }}
        onNodeClick={(_event, node) => {
          runtime.closeContextMenu();
          selectNode(node.id);
          expandNode(node.id);
        }}
        onNodeContextMenu={openNodeContextMenu}
        onPaneClick={() => {
          runtime.closeContextMenu();
          setSelectedNodeId(undefined);
          onInteractionChange(EMPTY_WORKBENCH_INTERACTION);
        }}
        onPaneContextMenu={openPaneContextMenu}
        onMoveEnd={handleMoveEnd}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.1}
          color="rgba(148, 163, 184, 0.16)"
        />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeStrokeWidth={0}
          nodeColor={(node) =>
            node.id === payload.document.rootNodeId
              ? 'rgba(165, 180, 252, 0.72)'
              : 'rgba(100, 116, 139, 0.68)'
          }
          maskColor="rgba(9, 12, 17, 0.56)"
        />
        <MindMapRendererOverlays
          document={payload.document}
          collapsedCount={viewState.collapsedNodeIds.length}
          staleAssociationCount={staleCount}
          onExpandAll={expandAll}
        />
      </ReactFlow>
    </div>
  );
}

export function MindMapWorkbenchView(
  props: RendererWorkbenchViewProps,
) {
  const payload = isMindMapWorkbenchPayload(props.bootstrap.payload)
    ? props.bootstrap.payload
    : undefined;

  if (!payload) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="text-sm font-medium text-rose-300">
            Mind Map Workbench 数据无效
          </p>
          <p className="mt-2 text-xs text-slate-500">
            请检查 .mindmap 的结构后刷新资料。
          </p>
        </div>
      </div>
    );
  }

  return (
    <MindMapCanvas
      key={props.bootstrap.sessionId}
      {...props}
      payload={payload}
    />
  );
}

export const mindMapRendererWorkbenchModule: RendererWorkbenchModule<
  typeof mindMapWorkbenchManifest.id
> = {
  manifest: mindMapWorkbenchManifest,
  View: MindMapWorkbenchView,
};

export default mindMapRendererWorkbenchModule;
