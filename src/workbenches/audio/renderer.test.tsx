import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import {
  audioErrorMessage,
  AudioWorkbenchView,
  hasLoadedAudioMetadata,
  revealAudioTarget,
} from './renderer';
import {
  AUDIO_WORKBENCH_ID,
  audioWorkbenchManifest,
  cloneAudioDubbingSnapshot,
  cloneAudioSpeakerTrackSnapshot,
  cloneAudioSubtitleSnapshot,
  cloneAudioViewState,
  createAudioTimeRangeTarget,
  DEFAULT_AUDIO_SUBTITLE_VIEW_STATE,
  DEFAULT_AUDIO_VIEW_STATE,
  EMPTY_AUDIO_DUBBING_SNAPSHOT,
  EMPTY_AUDIO_SPEAKER_TRACK_SNAPSHOT,
  EMPTY_AUDIO_SUBTITLE_SNAPSHOT,
} from './shared';

const asset: AssetSnapshot = {
  id: 'asset',
  projectId: 'project',
  name: '课程音频',
  mediaType: 'audio/mpeg',
  creationKind: 'imported',
  contentRef: {
    kind: 'local-file',
    base: 'absolute',
    path: '/tmp/private/lesson.mp3',
  },
  contentStatus: {
    availability: 'available',
    checkedTime: 100,
  },
  createdTime: 100,
  updatedTime: 100,
};

function render(payload: WorkbenchBootstrap['payload']) {
  const bootstrap: WorkbenchBootstrap = {
    sessionId: 'session',
    workbenchId: AUDIO_WORKBENCH_ID,
    workbenchVersion: audioWorkbenchManifest.version,
    protocolVersion: audioWorkbenchManifest.protocolVersion,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };

  return renderToStaticMarkup(
    <WorkbenchRuntimeProvider onError={vi.fn()}>
      <AudioWorkbenchView
        asset={asset}
        bootstrap={bootstrap}
        executeCommand={vi.fn(async () => ({
          payload: { saved: true, savedTime: 100 },
        }))}
        onRelink={vi.fn()}
        onRefresh={vi.fn()}
        onReveal={vi.fn()}
        onInteractionChange={vi.fn()}
        onOpenExternal={vi.fn(async () => undefined)}
        onError={vi.fn()}
      />
    </WorkbenchRuntimeProvider>,
  );
}

describe('AudioWorkbenchView', () => {
  it('reconciles media state that settled before effect listeners attach', () => {
    expect(hasLoadedAudioMetadata({ readyState: 0 })).toBe(false);
    expect(hasLoadedAudioMetadata({ readyState: 1 })).toBe(true);
    expect(audioErrorMessage({ code: 4 })).toContain('不支持');
  });

  it('reveals a Workbench-owned time-range Target without exposing media semantics to the bridge', () => {
    const pause = vi.fn();
    const seek = vi.fn();

    expect(revealAudioTarget(
      { readyState: 1, pause },
      createAudioTimeRangeTarget(12.5, 18),
      seek,
    )).toBe(true);
    expect(pause).toHaveBeenCalledOnce();
    expect(seek).toHaveBeenCalledWith(12.5);
    expect(revealAudioTarget(
      { readyState: 1, pause },
      { scope: 'asset' },
      seek,
    )).toBe(false);
  });

  it('renders compact media controls and the transcript area', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
      sourceRevision: 'test-revision',
      viewState: cloneAudioViewState(DEFAULT_AUDIO_VIEW_STATE),
      subtitleState: { ...DEFAULT_AUDIO_SUBTITLE_VIEW_STATE },
      subtitleSnapshot: cloneAudioSubtitleSnapshot(
        EMPTY_AUDIO_SUBTITLE_SNAPSHOT,
      ),
      dubbingSnapshot: cloneAudioDubbingSnapshot(
        EMPTY_AUDIO_DUBBING_SNAPSHOT,
      ),
      speakerTrackSnapshot: cloneAudioSpeakerTrackSnapshot(
        EMPTY_AUDIO_SPEAKER_TRACK_SNAPSHOT,
      ),
    });

    expect(markup).toContain('aria-label="音频播放器"');
    expect(markup).not.toContain('controls=""');
    expect(markup).toContain('aria-label="音频播放控件"');
    expect(markup).toContain('正在后台识别音频');
    expect(markup).toContain('learning-content://resource/token');
    expect(markup).not.toContain('标记当前时间');
    expect(markup).not.toContain('/tmp/private/lesson.mp3');
    const layout = markup.match(
      /<div[^>]*data-audio-workbench-layout="true"[^>]*>/u,
    )?.[0];
    const transcriptRegion = markup.match(
      /<div[^>]*data-audio-transcript-region="true"[^>]*>/u,
    )?.[0];
    expect(layout).toContain('w-full');
    expect(layout).toContain('min-w-0');
    expect(transcriptRegion).toContain('min-w-0');
    expect(transcriptRegion).toContain('overflow-hidden');
  });

  it('renders progressive bilingual text and reverse dubbing progress', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
      sourceRevision: 'test-revision',
      viewState: cloneAudioViewState(DEFAULT_AUDIO_VIEW_STATE),
      subtitleState: { displayMode: 'bilingual' },
      subtitleSnapshot: cloneAudioSubtitleSnapshot({
        phase: 'translating',
        source: {
          version: 1,
          kind: 'subtitle-source',
          sourceRevision: 'source-revision',
          language: 'en',
          origin: 'asr',
          engine: {
            id: 'asr',
            version: '1',
            model: 'model',
            backend: 'cpu',
          },
          generatedTime: 100,
          cues: [
            {
              id: 'cue-1',
              startMs: 0,
              endMs: 1_000,
              text: 'Hello.',
              sourceCueIds: ['raw-1'],
            },
          ],
        },
        partialTranslations: [{ sourceCueId: 'cue-1', text: '你好。' }],
        completedCues: 1,
        totalCues: 1,
      }),
      dubbingSnapshot: cloneAudioDubbingSnapshot({
        phase: 'cloning',
        completedPhrases: 1,
        totalPhrases: 2,
        completedDurationMs: 1_000,
        durationMs: 2_000,
        readySuffixStartMs: 1_000,
        previewAudioUrl: 'learning-content://resource/preview',
      }),
      speakerTrackSnapshot: cloneAudioSpeakerTrackSnapshot({
        track: {
          version: 1,
          kind: 'dubbing-speaker-track',
          sourceTrackRevision: 'source-track-revision',
          cues: [
            {
              sourceCueId: 'cue-1',
              speakerId: 'speaker-0001',
              status: 'stable',
            },
          ],
          profiles: [{ speakerId: 'speaker-0001', mode: 'default' }],
        },
      }),
    });

    expect(markup).toContain('Hello.');
    expect(markup).toContain('你好。');
    expect(markup).toContain('说话人 1');
    expect(markup).not.toContain('默认声线');
    expect(markup).not.toContain('待准备声色参考');
    expect(markup).toContain('aria-label="音频声音"');
    expect(markup).toContain('aria-label="音频字幕与配音"');
  });

  it('offers subtitle installation and blocks dubbing when runtimes are absent', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
      sourceRevision: 'test-revision',
      viewState: cloneAudioViewState(DEFAULT_AUDIO_VIEW_STATE),
      subtitleState: { displayMode: 'source' },
      subtitleSnapshot: cloneAudioSubtitleSnapshot({
        ...EMPTY_AUDIO_SUBTITLE_SNAPSHOT,
        phase: 'runtime-required',
      }),
      dubbingSnapshot: cloneAudioDubbingSnapshot({
        ...EMPTY_AUDIO_DUBBING_SNAPSHOT,
        phase: 'runtime-required',
      }),
      speakerTrackSnapshot: cloneAudioSpeakerTrackSnapshot(
        EMPTY_AUDIO_SPEAKER_TRACK_SNAPSHOT,
      ),
    });

    expect(markup).toContain('安装字幕');
    expect(markup).toContain('>等待字幕<');
    expect(markup).toContain('VoxCPM2 视频/音频配音组件尚未安装');
  });

  it('rejects an invalid bootstrap URL', () => {
    const markup = render({
      contentUrl: 'file:///tmp/private/lesson.mp3',
      sourceRevision: 'test-revision',
      viewState: cloneAudioViewState(DEFAULT_AUDIO_VIEW_STATE),
    });

    expect(markup).toContain('Audio Workbench 数据无效');
    expect(markup).not.toContain('音频播放器');
  });
});
