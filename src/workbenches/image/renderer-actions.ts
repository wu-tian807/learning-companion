import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action';

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
    ],
  };
}
