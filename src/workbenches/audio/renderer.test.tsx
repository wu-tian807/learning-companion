import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import {
  audioErrorMessage,
  AudioWorkbenchView,
  hasLoadedAudioMetadata,
} from './renderer';
import {
  AUDIO_WORKBENCH_ID,
  audioWorkbenchManifest,
  cloneAudioDubbingSnapshot,
  cloneAudioSubtitleSnapshot,
  cloneAudioViewState,
  DEFAULT_AUDIO_SUBTITLE_VIEW_STATE,
  DEFAULT_AUDIO_VIEW_STATE,
  EMPTY_AUDIO_DUBBING_SNAPSHOT,
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

  it('renders compact media controls and the transcript area', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
      viewState: cloneAudioViewState(DEFAULT_AUDIO_VIEW_STATE),
      subtitleState: { ...DEFAULT_AUDIO_SUBTITLE_VIEW_STATE },
      subtitleSnapshot: cloneAudioSubtitleSnapshot(
        EMPTY_AUDIO_SUBTITLE_SNAPSHOT,
      ),
      dubbingSnapshot: cloneAudioDubbingSnapshot(
        EMPTY_AUDIO_DUBBING_SNAPSHOT,
      ),
    });

    expect(markup).toContain('aria-label="音频播放器"');
    expect(markup).not.toContain('controls=""');
    expect(markup).toContain('aria-label="音频播放控件"');
    expect(markup).toContain('正在后台识别音频');
    expect(markup).toContain('learning-content://resource/token');
    expect(markup).not.toContain('标记当前时间');
    expect(markup).not.toContain('/tmp/private/lesson.mp3');
  });

  it('renders progressive bilingual text and reverse dubbing progress', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
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
    });

    expect(markup).toContain('Hello.');
    expect(markup).toContain('你好。');
    expect(markup).toContain('aria-label="音频声音"');
    expect(markup).toContain('aria-label="音频字幕与配音"');
  });

  it('offers component installation when subtitle and dubbing runtimes are absent', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
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
    });

    expect(markup).toContain('安装字幕');
    expect(markup).toContain('安装配音');
  });

  it('rejects an invalid bootstrap URL', () => {
    const markup = render({
      contentUrl: 'file:///tmp/private/lesson.mp3',
      viewState: cloneAudioViewState(DEFAULT_AUDIO_VIEW_STATE),
    });

    expect(markup).toContain('Audio Workbench 数据无效');
    expect(markup).not.toContain('音频播放器');
  });
});
