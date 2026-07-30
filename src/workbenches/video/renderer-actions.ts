import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action-bundle';

export interface VideoRendererActionsOptions {
  readonly ready: boolean;
  readonly onTogglePlayback: () => Promise<void> | void;
  readonly onReveal: () => Promise<void> | void;
}

export function createVideoRendererActions({
  ready,
  onTogglePlayback,
  onReveal,
}: VideoRendererActionsOptions): WorkbenchActionBundle {
  const disabledReason = ready ? undefined : '视频尚未载入完成';

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
        enabled: false,
        execute: () => undefined,
      },
      {
        id: 'video.ai.notes-from-here',
        enabled: false,
        execute: () => undefined,
      },
    ],
    contributions: [
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
          description: '把当前时间点和视频画面交给视觉模型',
          disabledReason: '等待 Video AI 工具接入',
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
