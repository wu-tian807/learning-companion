import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action-bundle';

export interface ImageRendererActionsOptions {
  readonly ready: boolean;
  readonly onFit: () => void;
  readonly onActualSize: () => void;
  readonly onRotateClockwise: () => void;
  readonly onRotateCounterclockwise: () => void;
  readonly onReset: () => void;
  readonly onReveal: () => Promise<void> | void;
}

export function createImageRendererActions({
  ready,
  onFit,
  onActualSize,
  onRotateClockwise,
  onRotateCounterclockwise,
  onReset,
  onReveal,
}: ImageRendererActionsOptions): WorkbenchActionBundle {
  const disabledReason = ready ? undefined : '图片尚未加载完成';

  return {
    actions: [
      {
        id: 'image.fit',
        enabled: ready,
        execute: onFit,
      },
      {
        id: 'image.actual-size',
        enabled: ready,
        execute: onActualSize,
      },
      {
        id: 'image.rotate.clockwise',
        enabled: ready,
        execute: onRotateClockwise,
      },
      {
        id: 'image.rotate.counterclockwise',
        enabled: ready,
        execute: onRotateCounterclockwise,
      },
      {
        id: 'image.reset',
        enabled: ready,
        execute: onReset,
      },
      {
        id: 'image.reveal',
        enabled: true,
        execute: onReveal,
      },
      {
        id: 'image.ai.analyze',
        enabled: false,
        execute: () => undefined,
      },
      {
        id: 'image.ai.analyze-viewport',
        enabled: false,
        execute: () => undefined,
      },
    ],
    contributions: [
      {
        id: 'image.fit.overflow',
        actionId: 'image.fit',
        surface: 'overflow',
        group: '10-scale',
        groupLabel: '查看',
        order: 10,
        presentation: {
          kind: 'action',
          label: '适应窗口',
          shortcut: 'Mod+0',
          disabledReason,
        },
      },
      {
        id: 'image.actual-size.overflow',
        actionId: 'image.actual-size',
        surface: 'overflow',
        group: '10-scale',
        order: 20,
        presentation: {
          kind: 'action',
          label: '实际大小',
          shortcut: 'Mod+1',
          disabledReason,
        },
      },
      {
        id: 'image.rotate.clockwise.overflow',
        actionId: 'image.rotate.clockwise',
        surface: 'overflow',
        group: '20-rotation',
        groupLabel: '旋转',
        order: 10,
        presentation: {
          kind: 'action',
          label: '顺时针旋转',
          shortcut: 'R',
          disabledReason,
        },
      },
      {
        id: 'image.rotate.counterclockwise.overflow',
        actionId: 'image.rotate.counterclockwise',
        surface: 'overflow',
        group: '20-rotation',
        order: 20,
        presentation: {
          kind: 'action',
          label: '逆时针旋转',
          shortcut: 'Shift+R',
          disabledReason,
        },
      },
      {
        id: 'image.reset.overflow',
        actionId: 'image.reset',
        surface: 'overflow',
        group: '20-rotation',
        order: 30,
        presentation: {
          kind: 'action',
          label: '重置视图',
          disabledReason,
        },
      },
      {
        id: 'image.reveal.overflow',
        actionId: 'image.reveal',
        surface: 'overflow',
        group: '30-file',
        order: 0,
        presentation: {
          kind: 'action',
          label: '在文件夹中显示',
        },
      },
      {
        id: 'image.fit.context-menu',
        actionId: 'image.fit',
        surface: 'context-menu',
        group: '10-view',
        groupLabel: '图片视图',
        order: 10,
        presentation: {
          kind: 'action',
          label: '适应窗口',
          disabledReason,
        },
      },
      {
        id: 'image.actual-size.context-menu',
        actionId: 'image.actual-size',
        surface: 'context-menu',
        group: '10-view',
        order: 20,
        presentation: {
          kind: 'action',
          label: '实际大小',
          disabledReason,
        },
      },
      {
        id: 'image.rotate.clockwise.context-menu',
        actionId: 'image.rotate.clockwise',
        surface: 'context-menu',
        group: '10-view',
        order: 30,
        presentation: {
          kind: 'action',
          label: '顺时针旋转',
          disabledReason,
        },
      },
      {
        id: 'image.ai.analyze.context-menu',
        actionId: 'image.ai.analyze',
        surface: 'context-menu',
        group: '80-ai',
        groupLabel: 'Image AI',
        order: 10,
        presentation: {
          kind: 'generation-tool',
          label: '分析整张图片',
          description: '将原始图片交给视觉模型',
          disabledReason: '等待 Image AI 工具接入',
        },
      },
      {
        id: 'image.ai.analyze-viewport.context-menu',
        actionId: 'image.ai.analyze-viewport',
        surface: 'context-menu',
        group: '80-ai',
        order: 20,
        presentation: {
          kind: 'generation-tool',
          label: '分析当前视野',
          description: '使用当前缩放、中心点和旋转状态',
          disabledReason: '等待 Image AI 工具接入',
        },
      },
      {
        id: 'image.reveal.context-menu',
        actionId: 'image.reveal',
        surface: 'context-menu',
        group: '90-file',
        order: 10,
        presentation: {
          kind: 'action',
          label: '在文件夹中显示',
        },
      },
    ],
  };
}
