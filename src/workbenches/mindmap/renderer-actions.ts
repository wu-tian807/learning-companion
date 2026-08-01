import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action-bundle';
import { isMindMapNodeTarget } from './shared';

export interface MindMapRendererActionsOptions {
  readonly canToggleFocusedNode: () => boolean;
  readonly hasCollapsedNodes: () => boolean;
  readonly onFit: () => void;
  readonly onToggleNode: (nodeId: string) => void;
  readonly onExpandAll: () => void;
  readonly onReveal: () => Promise<void> | void;
}

export function createMindMapRendererActions({
  canToggleFocusedNode,
  hasCollapsedNodes,
  onFit,
  onToggleNode,
  onExpandAll,
  onReveal,
}: MindMapRendererActionsOptions): WorkbenchActionBundle {
  return {
    actions: [
      {
        id: 'mindmap.fit',
        enabled: true,
        execute: onFit,
      },
      {
        id: 'mindmap.toggle-focused-node',
        enabled: canToggleFocusedNode,
        execute: (context) => {
          if (isMindMapNodeTarget(context.focus)) {
            onToggleNode(context.focus.anchorPayload.nodeId);
          }
        },
      },
      {
        id: 'mindmap.expand-all',
        enabled: hasCollapsedNodes,
        execute: onExpandAll,
      },
      {
        id: 'mindmap.reveal',
        enabled: true,
        execute: onReveal,
      },
      {
        id: 'mindmap.ai.ask-node',
        enabled: false,
        execute: () => undefined,
      },
      {
        id: 'mindmap.ai.generate-from-node',
        enabled: false,
        execute: () => undefined,
      },
      {
        id: 'mindmap.ai.generate-lecture',
        enabled: false,
        execute: () => undefined,
      },
    ],
    contributions: [
      {
        id: 'mindmap.fit.overflow',
        actionId: 'mindmap.fit',
        surface: 'overflow',
        group: '10-view',
        groupLabel: '查看',
        order: 10,
        presentation: {
          kind: 'action',
          label: '适应窗口',
          shortcut: 'Mod+0',
        },
      },
      {
        id: 'mindmap.expand-all.overflow',
        actionId: 'mindmap.expand-all',
        surface: 'overflow',
        group: '10-view',
        order: 20,
        presentation: {
          kind: 'action',
          label: '展开全部节点',
          disabledReason: '当前没有收起的节点',
        },
      },
      {
        id: 'mindmap.reveal.overflow',
        actionId: 'mindmap.reveal',
        surface: 'overflow',
        group: '90-file',
        order: 10,
        presentation: {
          kind: 'action',
          label: '在文件夹中显示',
        },
      },
      {
        id: 'mindmap.toggle-focused-node.context-menu',
        actionId: 'mindmap.toggle-focused-node',
        surface: 'context-menu',
        group: '10-node',
        groupLabel: '节点',
        order: 10,
        presentation: {
          kind: 'action',
          label: '展开 / 收起子节点',
          disabledReason: '请先选择一个含有子节点的节点',
        },
      },
      {
        id: 'mindmap.expand-all.context-menu',
        actionId: 'mindmap.expand-all',
        surface: 'context-menu',
        group: '10-node',
        order: 20,
        presentation: {
          kind: 'action',
          label: '展开全部节点',
          disabledReason: '当前没有收起的节点',
        },
      },
      {
        id: 'mindmap.ai.ask-node.context-menu',
        actionId: 'mindmap.ai.ask-node',
        surface: 'context-menu',
        group: '80-ai',
        groupLabel: 'Mind Map AI',
        order: 10,
        presentation: {
          kind: 'generation-tool',
          label: '围绕此节点提问',
          description: '将当前节点作为资料上下文',
          disabledReason: '等待 Agent Lane 接入',
        },
      },
      {
        id: 'mindmap.ai.generate-from-node.context-menu',
        actionId: 'mindmap.ai.generate-from-node',
        surface: 'context-menu',
        group: '80-ai',
        order: 20,
        presentation: {
          kind: 'generation-tool',
          label: '从此节点派生资料',
          description: '生成与节点关联的新 Asset',
          disabledReason: '等待 Generated Asset 工作流接入',
        },
      },
      {
        id: 'mindmap.reveal.context-menu',
        actionId: 'mindmap.reveal',
        surface: 'context-menu',
        group: '90-file',
        order: 10,
        presentation: {
          kind: 'action',
          label: '在文件夹中显示',
        },
      },
      {
        id: 'mindmap.ai.generate-lecture.generation-center',
        actionId: 'mindmap.ai.generate-lecture',
        surface: 'generation-center',
        group: '10-generate',
        groupLabel: 'Mind Map',
        order: 10,
        presentation: {
          kind: 'generation-tool',
          label: '生成讲义',
          description: '从选中的节点或 Frame 派生讲义 Asset',
          disabledReason: '等待 Mind Map 生成工作流接入',
        },
      },
    ],
  };
}
