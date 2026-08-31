import type { MediaSubtitleSnapshot } from '../media-subtitles/presentation';
import type { MediaDubbingSnapshot } from './contracts';

export interface MediaDubbingReadiness {
  readonly ready: boolean;
  readonly blockers: readonly string[];
  readonly message?: string;
}

function subtitleSourceBlocker(
  snapshot: MediaSubtitleSnapshot,
): string | undefined {
  if (snapshot.source) return undefined;
  if (snapshot.phase === 'runtime-required') {
    return snapshot.message ?? '字幕组件尚未安装，无法生成字幕。';
  }
  if (snapshot.phase === 'failed') {
    return snapshot.message ?? '字幕生成失败，请先重试。';
  }
  if (snapshot.phase === 'queued' || snapshot.phase === 'transcribing') {
    return '字幕正在生成，完成后才能开始配音。';
  }
  return '字幕尚未生成完成。';
}

function subtitleTranslationBlocker(
  snapshot: MediaSubtitleSnapshot,
): string | undefined {
  if (!snapshot.source || snapshot.translation) return undefined;
  if (snapshot.phase === 'provider-required') {
    return snapshot.message ?? '“低智能”翻译连接不可用，请先在设置中完成配置。';
  }
  if (snapshot.phase === 'translating') {
    return `译文正在生成（${snapshot.completedCues}/${snapshot.totalCues}），完成后才能开始配音。`;
  }
  if (snapshot.phase === 'unsupported-language') {
    return snapshot.message ?? '当前字幕语言暂不支持自动翻译。';
  }
  if (snapshot.phase === 'failed') {
    return snapshot.message ?? '译文生成失败，请先重试。';
  }
  return '译文尚未生成，请先选择“译文”或“双语”完成翻译。';
}

function dubbingRuntimeBlocker(
  snapshot: MediaDubbingSnapshot,
): string | undefined {
  if (snapshot.phase === 'runtime-required') {
    return (
      snapshot.message ??
      'VoxCPM2 视频/音频配音组件尚未安装，请先在设置中安装。'
    );
  }
  if (snapshot.phase === 'unsupported') {
    return snapshot.message ?? '当前设备不支持 VoxCPM2 配音。';
  }
  return undefined;
}

export function resolveMediaDubbingReadiness(
  subtitleSnapshot: MediaSubtitleSnapshot,
  dubbingSnapshot: MediaDubbingSnapshot,
): MediaDubbingReadiness {
  const blockers = [
    subtitleSourceBlocker(subtitleSnapshot),
    subtitleTranslationBlocker(subtitleSnapshot),
    dubbingRuntimeBlocker(dubbingSnapshot),
  ].filter((blocker): blocker is string => blocker !== undefined);
  const frozenBlockers = Object.freeze(blockers);
  return Object.freeze({
    ready: frozenBlockers.length === 0,
    blockers: frozenBlockers,
    ...(frozenBlockers.length === 0
      ? {}
      : { message: frozenBlockers.join('\n') }),
  });
}
