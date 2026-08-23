import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action-bundle';

export interface VideoRendererActionsOptions {
  readonly ready: boolean;
  readonly canExplainFrame: boolean;
  readonly explanationCount?: number;
  readonly indexOpen?: boolean;
  readonly markersVisible?: boolean;
  readonly canToggleIndex?: boolean;
  readonly onTogglePlayback: () => Promise<void> | void;
  readonly onExplainFrame: () => Promise<void> | void;
  readonly onToggleIndex?: () => Promise<void> | void;
  readonly onToggleMarkers?: () => Promise<void> | void;
  readonly onReveal: () => Promise<void> | void;
}

export function createVideoRendererActions({
  ready,
  canExplainFrame,
  explanationCount = 0,
  indexOpen = false,
  markersVisible = true,
  canToggleIndex = true,
  onTogglePlayback,
  onExplainFrame,
  onToggleIndex = () => undefined,
  onToggleMarkers = () => undefined,
  onReveal,
}: VideoRendererActionsOptions): WorkbenchActionBundle {
  const disabledReason = ready ? undefined : '视频尚未载入完成';
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
        id: 'video.toggle-playback',
        enabled: ready,
        execute: onTogglePlayback,
      },
      {
        id: 'video.reveal',
        enabled: true,
        execute: onReveal,
      },
      {
        id: 'video.ai.explain-frame',
        enabled: canExplainFrame,
        execute: onExplainFrame,
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
      {
        id: 'video.ai.notes-from-here',
        enabled: false,
        execute: () => undefined,
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
      {
        id: 'video.toggle-playback.context-menu',
        actionId: 'video.toggle-playback',
        surface: 'context-menu',
        group: '10-playback',
        groupLabel: '视频',
        order: 10,
        presentation: {
          kind: 'action',
          label: '播放 / 暂停',
          disabledReason,
        },
      },
      {
        id: 'video.ai.explain-frame.context-menu',
        actionId: 'video.ai.explain-frame',
        surface: 'context-menu',
        group: '80-ai',
        groupLabel: 'Video AI',
        order: 10,
        presentation: {
          kind: 'generation-tool',
          label: '解释当前画面',
          description: '回答会保存为可按时间定位的视频标注',
          ...(!canExplainFrame
            ? { disabledReason: '请先在画面上按住右键并框选区域' }
            : {}),
        },
      },
      {
        id: 'video.ai.notes-from-here.context-menu',
        actionId: 'video.ai.notes-from-here',
        surface: 'context-menu',
        group: '80-ai',
        order: 20,
        presentation: {
          kind: 'generation-tool',
          label: '从这里生成学习笔记',
          description: '从当前时间点开始分析后续片段',
          disabledReason: '等待 Video AI 工具接入',
        },
      },
      {
        id: 'video.reveal.context-menu',
        actionId: 'video.reveal',
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
