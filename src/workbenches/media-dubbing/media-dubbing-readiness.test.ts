import { describe, expect, it } from 'vitest';

import { EMPTY_MEDIA_SUBTITLE_SNAPSHOT } from '../media-subtitles/presentation';
import { EMPTY_MEDIA_DUBBING_SNAPSHOT } from './contracts';
import { resolveMediaDubbingReadiness } from './media-dubbing-readiness';

const source = {
  version: 1 as const,
  kind: 'subtitle-source' as const,
  sourceRevision: 'source-revision',
  language: 'en' as const,
  origin: 'asr' as const,
  engine: { id: 'whisper', version: '1', model: 'turbo', backend: 'cuda' },
  generatedTime: 100,
  cues: [],
};

const translation = {
  version: 1 as const,
  kind: 'subtitle-translation' as const,
  sourceTrackRevision: 'source-revision',
  sourceLanguage: 'en' as const,
  targetLanguage: 'zh-Hans' as const,
  profile: 'quality' as const,
  engine: { id: 'codex', version: '1', model: 'gpt', backend: 'agent' },
  generatedTime: 200,
  cues: [],
};

describe('resolveMediaDubbingReadiness', () => {
  it('reports subtitle generation and the external package as separate blockers', () => {
    const readiness = resolveMediaDubbingReadiness(
      { ...EMPTY_MEDIA_SUBTITLE_SNAPSHOT, phase: 'transcribing' },
      { ...EMPTY_MEDIA_DUBBING_SNAPSHOT, phase: 'runtime-required' },
    );

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual([
      '字幕正在生成，完成后才能开始配音。',
      'VoxCPM2 视频/音频配音组件尚未安装，请先在设置中安装。',
    ]);
  });

  it('reports translation progress after source subtitles are ready', () => {
    const readiness = resolveMediaDubbingReadiness(
      {
        ...EMPTY_MEDIA_SUBTITLE_SNAPSHOT,
        phase: 'translating',
        source,
        completedCues: 3,
        totalCues: 10,
      },
      EMPTY_MEDIA_DUBBING_SNAPSHOT,
    );

    expect(readiness.blockers).toEqual([
      '译文正在生成（3/10），完成后才能开始配音。',
    ]);
  });

  it('preserves the actionable low-tier Provider error', () => {
    const message =
      '“低智能”翻译连接未通过验证。请在设置中完成登录，或配置有效的 API Key。';
    const readiness = resolveMediaDubbingReadiness(
      {
        ...EMPTY_MEDIA_SUBTITLE_SNAPSHOT,
        phase: 'provider-required',
        source,
        message,
      },
      EMPTY_MEDIA_DUBBING_SNAPSHOT,
    );

    expect(readiness).toMatchObject({ ready: false, message });
  });

  it('explains when the current device cannot run VoxCPM2', () => {
    const readiness = resolveMediaDubbingReadiness(
      {
        ...EMPTY_MEDIA_SUBTITLE_SNAPSHOT,
        phase: 'ready',
        source,
        translation,
      },
      { ...EMPTY_MEDIA_DUBBING_SNAPSHOT, phase: 'unsupported' },
    );

    expect(readiness).toMatchObject({
      ready: false,
      message: '当前设备不支持 VoxCPM2 配音。',
    });
  });

  it('is ready only when source, translation and runtime are all available', () => {
    expect(
      resolveMediaDubbingReadiness(
        {
          ...EMPTY_MEDIA_SUBTITLE_SNAPSHOT,
          phase: 'ready',
          source,
          translation,
        },
        EMPTY_MEDIA_DUBBING_SNAPSHOT,
      ),
    ).toEqual({ ready: true, blockers: [] });
  });
});
