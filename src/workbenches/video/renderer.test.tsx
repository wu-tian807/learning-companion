import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import {
  hasLoadedVideoMetadata,
  mediaErrorMessage,
  createVideoSubtitleVtt,
  VideoWorkbenchView,
} from './renderer';
import {
  cloneVideoViewState,
  cloneVideoSubtitleSnapshot,
  DEFAULT_VIDEO_SUBTITLE_VIEW_STATE,
  EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
  DEFAULT_VIDEO_VIEW_STATE,
  VIDEO_WORKBENCH_ID,
  videoWorkbenchManifest,
} from './shared';

const asset: AssetSnapshot = {
  id: 'asset',
  projectId: 'project',
  name: '课程视频',
  mediaType: 'video/mp4',
  creationKind: 'imported',
  contentRef: {
    kind: 'local-file',
    base: 'absolute',
    path: '/tmp/private/lesson.mp4',
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
    workbenchId: VIDEO_WORKBENCH_ID,
    workbenchVersion: videoWorkbenchManifest.version,
    protocolVersion: videoWorkbenchManifest.protocolVersion,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };

  return renderToStaticMarkup(
    <WorkbenchRuntimeProvider onError={vi.fn()}>
      <VideoWorkbenchView
        asset={asset}
        bootstrap={bootstrap}
        executeCommand={vi.fn(async () => ({
          payload: { saved: true, savedTime: 100 },
        }))}
        subscribeEvent={vi.fn(() => () => undefined)}
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

describe('VideoWorkbenchView', () => {
  it('renders source, partial translation, and explicit bilingual fallback cues', () => {
    const snapshot = {
      phase: 'translating' as const,
      source: {
        version: 1 as const,
        kind: 'subtitle-source' as const,
        sourceRevision: 'video-revision',
        language: 'en' as const,
        origin: 'asr' as const,
        engine: { id: 'asr', version: '1', model: 'model', backend: 'cpu' },
        generatedTime: 100,
        cues: [
          { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Hello.', sourceCueIds: ['raw-1'] },
          { id: 'cue-2', startMs: 1_200, endMs: 2_000, text: 'World.', sourceCueIds: ['raw-2'] },
        ],
      },
      partialTranslations: [{ sourceCueId: 'cue-1', text: '你好。' }],
      completedCues: 1,
      totalCues: 2,
    };

    expect(createVideoSubtitleVtt(snapshot, 'source')).toContain('Hello.');
    expect(createVideoSubtitleVtt(snapshot, 'translated')).toContain(
      '〔原文 · 译文生成中〕World.',
    );
    const bilingual = createVideoSubtitleVtt(snapshot, 'bilingual');
    expect(bilingual).toContain('Hello.\n你好。');
    expect(bilingual).toContain('World.\n〔正在翻译…〕');
    expect(createVideoSubtitleVtt(snapshot, 'off')).toBeUndefined();
  });

  it('reconciles media state that settled before effect listeners attach', () => {
    expect(hasLoadedVideoMetadata({ readyState: 0 })).toBe(false);
    expect(hasLoadedVideoMetadata({ readyState: 1 })).toBe(true);
    expect(mediaErrorMessage({ code: 4 })).toContain('不支持');
  });

  it('renders the native video element without exposing its file path', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
      viewState: cloneVideoViewState(DEFAULT_VIDEO_VIEW_STATE),
      subtitleState: DEFAULT_VIDEO_SUBTITLE_VIEW_STATE,
      subtitleSnapshot: cloneVideoSubtitleSnapshot(
        EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
      ),
    });

    expect(markup).toContain('aria-label="视频播放器"');
    expect(markup).toContain('controls=""');
    expect(markup).toContain('learning-content://resource/token');
    expect(markup).not.toContain('标记当前时间');
    expect(markup).not.toContain('/tmp/private/lesson.mp4');
  });

  it('rejects an invalid bootstrap URL', () => {
    const markup = render({
      contentUrl: 'file:///tmp/private/lesson.mp4',
      viewState: cloneVideoViewState(DEFAULT_VIDEO_VIEW_STATE),
      subtitleState: DEFAULT_VIDEO_SUBTITLE_VIEW_STATE,
      subtitleSnapshot: cloneVideoSubtitleSnapshot(
        EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
      ),
    });

    expect(markup).toContain('Video Workbench 数据无效');
    expect(markup).not.toContain('视频播放器');
  });
});
