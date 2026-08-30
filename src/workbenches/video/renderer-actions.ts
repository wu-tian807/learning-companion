import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action-bundle';

export interface VideoRendererActionsOptions {
  readonly ready: boolean;
  readonly explanationCount?: number;
  readonly indexOpen?: boolean;
  readonly markersVisible?: boolean;
  readonly canToggleIndex?: boolean;
  readonly onToggleIndex?: () => Promise<void> | void;
  readonly onToggleMarkers?: () => Promise<void> | void;
  readonly onReveal: () => Promise<void> | void;
}

export function createVideoRendererActions({
  ready,
  explanationCount = 0,
  indexOpen = false,
  markersVisible = true,
  canToggleIndex = true,
  onToggleIndex = () => undefined,
  onToggleMarkers = () => undefined,
  onReveal,
}: VideoRendererActionsOptions): WorkbenchActionBundle {
  const headerContributions = ready
    ? [
        {
          id: 'video.explanations.toggle-index.header',
          actionId: 'video.explanations.toggle-index',
          surface: 'header' as const,
          group: '10-video-explanations',
          order: 20,
          presentation: {
            kind: 'action' as const,
            label: '标注',
            ariaLabel: `切换视频标注索引（${explanationCount}）`,
            badge: String(explanationCount),
            expanded: indexOpen,
            disabledReason: canToggleIndex
              ? undefined
              : '请先完成当前视频操作',
          },
        },
        ...(explanationCount > 0
          ? [
              {
                id: 'video.explanations.toggle-markers.header',
                actionId: 'video.explanations.toggle-markers',
                surface: 'header' as const,
                group: '10-video-explanations',
                order: 30,
                presentation: {
                  kind: 'checkbox' as const,
                  label: markersVisible ? '隐藏标注' : '显示标注',
                  ariaLabel: `${markersVisible ? '隐藏标注' : '显示标注'}（${explanationCount}）`,
                  badge: String(explanationCount),
                  checked: !markersVisible,
                  description: markersVisible
                    ? '隐藏当前视频帧上的区域边框和编号'
                    : '重新显示当前视频帧上的区域边框和编号',
                },
              },
            ]
          : []),
      ]
    : [];

  return {
    actions: [
      {
        id: 'video.reveal',
        enabled: true,
        execute: onReveal,
      },
      {
        id: 'video.explanations.toggle-index',
        enabled: ready && canToggleIndex,
        execute: onToggleIndex,
      },
      {
        id: 'video.explanations.toggle-markers',
        enabled: ready && explanationCount > 0,
        execute: onToggleMarkers,
      },
    ],
    contributions: [
      ...headerContributions,
      {
        id: 'video.reveal.overflow',
        actionId: 'video.reveal',
        surface: 'overflow',
        group: '20-file',
        order: 10,
        presentation: {
          kind: 'action',
          label: '在文件夹中显示',
        },
      },
    ],
  };
}
