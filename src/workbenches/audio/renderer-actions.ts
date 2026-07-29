import type { WorkbenchActionBundle } from '../../renderer/workbench/actions/workbench-action';
import { AUDIO_PLAYBACK_RATES } from './shared';

export interface AudioRendererActionsOptions {
  readonly ready: boolean;
  readonly playbackRate: number;
  readonly onTogglePlayback: () => Promise<void> | void;
  readonly onMarkCurrentTime: () => void;
  readonly onPlaybackRate: (rate: number) => void;
  readonly onReveal: () => Promise<void> | void;
}

export function createAudioRendererActions({
  ready,
  playbackRate,
  onTogglePlayback,
  onMarkCurrentTime,
  onPlaybackRate,
  onReveal,
}: AudioRendererActionsOptions): WorkbenchActionBundle {
  const disabledReason = ready ? undefined : '音频尚未载入完成';
  const playbackRateActions = AUDIO_PLAYBACK_RATES.map((rate) => ({
    id: `audio.playback-rate.${rate}`,
    enabled: ready,
    execute: () => onPlaybackRate(rate),
  }));

  return {
    actions: [
      {
        id: 'audio.toggle-playback',
        enabled: ready,
        execute: onTogglePlayback,
      },
      {
        id: 'audio.mark-current-time',
        enabled: ready,
        execute: onMarkCurrentTime,
      },
      ...playbackRateActions,
      {
        id: 'audio.reveal',
        enabled: true,
        execute: onReveal,
      },
      {
        id: 'audio.ai.explain-segment',
        enabled: false,
        execute: () => undefined,
      },
      {
        id: 'audio.ai.notes-from-here',
        enabled: false,
        execute: () => undefined,
      },
    ],
    contributions: [
      {
        id: 'audio.mark-current-time.overflow',
        actionId: 'audio.mark-current-time',
        surface: 'overflow',
        group: '10-timeline',
        order: 10,
        presentation: {
          kind: 'action',
          label: '标记当前时间',
          disabledReason,
        },
      },
      ...AUDIO_PLAYBACK_RATES.map((rate, index) => ({
        id: `audio.playback-rate.${rate}.overflow`,
        actionId: `audio.playback-rate.${rate}`,
        surface: 'overflow' as const,
        group: '20-playback-rate',
        groupLabel: '播放速度',
        order: index,
        presentation: {
          kind: 'radio' as const,
          label: `${rate}×`,
          checked: playbackRate === rate,
          radioGroup: 'audio.playback-rate',
          disabledReason,
          closePolicy: 'on-success' as const,
        },
      })),
      {
        id: 'audio.reveal.overflow',
        actionId: 'audio.reveal',
        surface: 'overflow',
        group: '30-file',
        order: 10,
        presentation: {
          kind: 'action',
          label: '在文件夹中显示',
        },
      },
      {
        id: 'audio.toggle-playback.context-menu',
        actionId: 'audio.toggle-playback',
        surface: 'context-menu',
        group: '10-playback',
        groupLabel: '音频',
        order: 10,
        presentation: {
          kind: 'action',
          label: '播放 / 暂停',
          disabledReason,
        },
      },
      {
        id: 'audio.mark-current-time.context-menu',
        actionId: 'audio.mark-current-time',
        surface: 'context-menu',
        group: '10-playback',
        order: 20,
        presentation: {
          kind: 'action',
          label: '标记当前时间',
          disabledReason,
        },
      },
      {
        id: 'audio.ai.explain-segment.context-menu',
        actionId: 'audio.ai.explain-segment',
        surface: 'context-menu',
        group: '80-ai',
        groupLabel: 'Audio AI',
        order: 10,
        presentation: {
          kind: 'generation-tool',
          label: '解释这一段',
          description: '使用当前音频时间点附近的内容',
          disabledReason: '等待 Audio AI 与转写能力接入',
        },
      },
      {
        id: 'audio.ai.notes-from-here.context-menu',
        actionId: 'audio.ai.notes-from-here',
        surface: 'context-menu',
        group: '80-ai',
        order: 20,
        presentation: {
          kind: 'generation-tool',
          label: '从这里生成学习笔记',
          description: '从当前时间点开始分析后续音频',
          disabledReason: '等待 Audio AI 与转写能力接入',
        },
      },
      {
        id: 'audio.reveal.context-menu',
        actionId: 'audio.reveal',
        surface: 'context-menu',
        group: '90-file',
        order: 10,
        presentation: {
          kind: 'action',
          label: '在文件夹中显示',
        },
      },
      {
        id: 'audio.ai.explain-segment.generation-center',
        actionId: 'audio.ai.explain-segment',
        surface: 'generation-center',
        group: '10-audio-ai',
        order: 10,
        presentation: {
          kind: 'generation-tool',
          label: '解释当前音频片段',
          description: '结合当前时间点附近的转写内容进行解释',
          disabledReason: '等待 Audio AI 与转写能力接入',
        },
      },
      {
        id: 'audio.ai.notes-from-here.generation-center',
        actionId: 'audio.ai.notes-from-here',
        surface: 'generation-center',
        group: '10-audio-ai',
        order: 20,
        presentation: {
          kind: 'generation-tool',
          label: '生成音频学习笔记',
          description: '从当前时间点开始整理后续音频内容',
          disabledReason: '等待 Audio AI 与转写能力接入',
        },
      },
    ],
  };
}
