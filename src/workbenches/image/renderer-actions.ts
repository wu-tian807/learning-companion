import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action-bundle';
import type { WorkbenchContribution } from '../../renderer/workbench/actions/workbench-contribution';

export interface ImageRendererActionsOptions {
  readonly ready: boolean;
  readonly aiBusy?: boolean;
  readonly canStartSelection?: boolean;
  readonly explanationCount?: number;
  readonly indexOpen?: boolean;
  readonly markersVisible?: boolean;
  readonly canToggleIndex?: boolean;
  readonly onFit: () => void;
  readonly onActualSize: () => void;
  readonly onRotateClockwise: () => void;
  readonly onRotateCounterclockwise: () => void;
  readonly onReset: () => void;
  readonly onExplainRegion: () => void;
  readonly onToggleIndex?: () => void;
  readonly onToggleMarkers?: () => void;
  readonly onReveal: () => Promise<void> | void;
}

export function createImageRendererActions({
  ready,
  aiBusy = false,
  canStartSelection = ready && !aiBusy,
  explanationCount = 0,
  indexOpen = false,
  markersVisible = true,
  canToggleIndex = true,
  onFit,
  onActualSize,
  onRotateClockwise,
  onRotateCounterclockwise,
  onReset,
  onExplainRegion,
  onToggleIndex = () => undefined,
  onToggleMarkers = () => undefined,
  onReveal,
}: ImageRendererActionsOptions): WorkbenchActionBundle {
  const disabledReason = ready ? undefined : '图片尚未加载完成';
  const explanationDisabledReason =
    disabledReason ??
    (!canStartSelection
      ? aiBusy
        ? '请先等待当前 AI 回答完成或停止生成'
        : '请先完成当前图片操作'
      : undefined);
  const headerContributions: readonly WorkbenchContribution[] = ready
    ? [
        {
          id: 'image.ai.explain-region.header',
          actionId: 'image.ai.explain-region',
          surface: 'header',
          group: '10-image-explanations',
          order: 10,
          presentation: {
            kind: 'action',
            label: '框选解释',
            tone: 'accent',
            description: '框选一个区域，AI 会结合整张图片进行解释',
            disabledReason: explanationDisabledReason,
          },
        },
        {
          id: 'image.explanations.toggle-index.header',
          actionId: 'image.explanations.toggle-index',
          surface: 'header',
          group: '10-image-explanations',
          order: 20,
          presentation: {
            kind: 'action',
            label: '标注',
            ariaLabel: `切换图片标注索引（${explanationCount}）`,
            badge: String(explanationCount),
            expanded: indexOpen,
            disabledReason: canToggleIndex
              ? undefined
              : '请先完成当前图片操作',
          },
        },
        ...(explanationCount > 0
          ? [
              {
                id: 'image.explanations.toggle-markers.header',
                actionId: 'image.explanations.toggle-markers',
                surface: 'header' as const,
                group: '10-image-explanations',
                order: 30,
                presentation: {
                  kind: 'checkbox' as const,
                  label: markersVisible ? '隐藏标注' : '显示标注',
                  ariaLabel: `${markersVisible ? '隐藏标注' : '显示标注'}（${explanationCount}）`,
                  badge: String(explanationCount),
                  checked: !markersVisible,
                  description: markersVisible
                    ? '隐藏图片上的区域边框和编号'
                    : '重新显示图片上的区域边框和编号',
                },
              },
            ]
          : []),
      ]
    : [];

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
        id: 'image.ai.explain-region',
        enabled: ready && canStartSelection,
        execute: onExplainRegion,
      },
      {
        id: 'image.explanations.toggle-index',
        enabled: ready && canToggleIndex,
        execute: onToggleIndex,
      },
      {
        id: 'image.explanations.toggle-markers',
        enabled: ready && explanationCount > 0,
        execute: onToggleMarkers,
      },
    ],
    contributions: [
      ...headerContributions,
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
          kind: 'action',
          label: '分析整张图片',
          description: '将原始图片交给视觉模型',
          disabledReason: '等待 Image AI 工具接入',
        },
      },
      {
        id: 'image.ai.explain-region.context-menu',
        actionId: 'image.ai.explain-region',
        surface: 'context-menu',
        group: '80-ai',
        order: 20,
        presentation: {
          kind: 'action',
          label: '框选区域并解释',
          description: '结合整张图片理解你感兴趣的区域',
          disabledReason:
            explanationDisabledReason,
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
