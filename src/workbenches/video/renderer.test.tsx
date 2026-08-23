// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import { WorkbenchConversationRuntimeProvider } from '../../renderer/conversation/WorkbenchConversationRuntimeProvider';
import {
  createVideoFrameRegionFromClientPoints,
  isClientPointInsideVideoFrameRegion,
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

vi.mock('../../renderer/workbench/runtime/use-workbench-contributions', () => ({
  useWorkbenchContributions: vi.fn(),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
    <WorkbenchConversationRuntimeProvider>
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
      </WorkbenchRuntimeProvider>
    </WorkbenchConversationRuntimeProvider>,
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
          {
            id: 'cue-1',
            startMs: 0,
            endMs: 1_000,
            text: 'Hello.',
            sourceCueIds: ['raw-1'],
          },
          {
            id: 'cue-2',
            startMs: 1_200,
            endMs: 2_000,
            text: 'World.',
            sourceCueIds: ['raw-2'],
          },
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

  it('refreshes a queued first-open bootstrap when the completion event was missed', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const previousBridge = window.learningCompanion;
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined);
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        listVideoExplanations: vi.fn(async () => []),
        onVideoExplanationChanged: vi.fn(() => () => undefined),
        onGenerationTaskChanged: vi.fn(() => () => undefined),
      },
    });
    const executeCommand = vi.fn(async () => ({
      payload: {
        phase: 'runtime-required',
        partialTranslations: [],
        completedCues: 0,
        totalCues: 0,
      },
    }));
    const bootstrap: WorkbenchBootstrap = {
      sessionId: 'session',
      workbenchId: VIDEO_WORKBENCH_ID,
      workbenchVersion: videoWorkbenchManifest.version,
      protocolVersion: videoWorkbenchManifest.protocolVersion,
      assetId: asset.id,
      mediaType: asset.mediaType,
      availability: 'available',
      payload: {
        contentUrl: 'learning-content://resource/token',
        sourceRevision: '100',
        viewState: cloneVideoViewState(DEFAULT_VIDEO_VIEW_STATE),
        subtitleState: DEFAULT_VIDEO_SUBTITLE_VIEW_STATE,
        subtitleSnapshot: {
          phase: 'queued',
          partialTranslations: [],
          completedCues: 0,
          totalCues: 0,
        },
      },
    };

    try {
      await act(async () => {
        root.render(
          <WorkbenchConversationRuntimeProvider>
            <WorkbenchRuntimeProvider onError={vi.fn()}>
              <VideoWorkbenchView
                asset={asset}
                bootstrap={bootstrap}
                executeCommand={executeCommand}
                subscribeEvent={vi.fn(() => () => undefined)}
                onRelink={vi.fn()}
                onRefresh={vi.fn()}
                onReveal={vi.fn()}
                onInteractionChange={vi.fn()}
                onOpenExternal={vi.fn(async () => undefined)}
                onError={vi.fn()}
              />
            </WorkbenchRuntimeProvider>
          </WorkbenchConversationRuntimeProvider>,
        );
      });

      expect(executeCommand).toHaveBeenCalledWith({
        type: 'video:get-subtitle-snapshot',
      });
      expect(container.textContent).toContain('需要字幕组件');
      expect(container.textContent).not.toContain('正在准备字幕…');
    } finally {
      act(() => root.unmount());
      container.remove();
      Object.defineProperty(window, 'learningCompanion', {
        configurable: true,
        value: previousBridge,
      });
      pause.mockRestore();
    }
  });

  it('reconciles a missed first-open subtitle event without overwriting a newer event', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const previousBridge = window.learningCompanion;
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined);
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        listVideoExplanations: vi.fn(async () => []),
        onVideoExplanationChanged: vi.fn(() => () => undefined),
        onGenerationTaskChanged: vi.fn(() => () => undefined),
      },
    });
    const queued = {
      phase: 'queued' as const,
      partialTranslations: [],
      completedCues: 0,
      totalCues: 0,
    };
    const ready = {
      phase: 'source-ready' as const,
      source: {
        version: 1 as const,
        kind: 'subtitle-source' as const,
        sourceRevision: '100',
        language: 'zh-Hans' as const,
        origin: 'asr' as const,
        engine: {
          id: 'sense-voice',
          version: '1',
          model: 'small',
          backend: 'cpu',
        },
        generatedTime: 200,
        cues: [
          {
            id: 'cue-1',
            startMs: 0,
            endMs: 1_000,
            text: '第一句字幕',
            sourceCueIds: ['raw-1'],
          },
        ],
      },
      partialTranslations: [],
      completedCues: 0,
      totalCues: 0,
    };
    let resolveSnapshot:
      ((value: { payload: typeof queued }) => void) | undefined;
    const executeCommand = vi.fn(
      () =>
        new Promise<{ payload: typeof queued }>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    let publishEvent:
      | ((event: {
          sessionId: string;
          type: string;
          payload: typeof ready;
        }) => void)
      | undefined;
    const bootstrap: WorkbenchBootstrap = {
      sessionId: 'session',
      workbenchId: VIDEO_WORKBENCH_ID,
      workbenchVersion: videoWorkbenchManifest.version,
      protocolVersion: videoWorkbenchManifest.protocolVersion,
      assetId: asset.id,
      mediaType: asset.mediaType,
      availability: 'available',
      payload: {
        contentUrl: 'learning-content://resource/token',
        sourceRevision: '100',
        viewState: cloneVideoViewState(DEFAULT_VIDEO_VIEW_STATE),
        subtitleState: DEFAULT_VIDEO_SUBTITLE_VIEW_STATE,
        subtitleSnapshot: queued,
      },
    };

    try {
      await act(async () => {
        root.render(
          <WorkbenchConversationRuntimeProvider>
            <WorkbenchRuntimeProvider onError={vi.fn()}>
              <VideoWorkbenchView
                asset={asset}
                bootstrap={bootstrap}
                executeCommand={executeCommand}
                subscribeEvent={(listener) => {
                  publishEvent = listener;
                  return () => undefined;
                }}
                onRelink={vi.fn()}
                onRefresh={vi.fn()}
                onReveal={vi.fn()}
                onInteractionChange={vi.fn()}
                onOpenExternal={vi.fn(async () => undefined)}
                onError={vi.fn()}
              />
            </WorkbenchRuntimeProvider>
          </WorkbenchConversationRuntimeProvider>,
        );
      });

      expect(executeCommand).toHaveBeenCalledWith({
        type: 'video:get-subtitle-snapshot',
      });
      expect(container.textContent).toContain('正在准备字幕…');

      act(() => {
        publishEvent?.({
          sessionId: 'session',
          type: 'video:subtitle-snapshot',
          payload: ready,
        });
      });
      expect(container.textContent).toContain('原文可用');

      await act(async () => {
        resolveSnapshot?.({ payload: queued });
      });
      expect(container.textContent).toContain('原文可用');
      expect(container.textContent).not.toContain('正在准备字幕…');
    } finally {
      act(() => root.unmount());
      container.remove();
      Object.defineProperty(window, 'learningCompanion', {
        configurable: true,
        value: previousBridge,
      });
      pause.mockRestore();
    }
  });

  it('turns a right-button drag into a normalized frame region without guessing time', () => {
    const target = createVideoFrameRegionFromClientPoints(
      {
        videoWidth: 1920,
        videoHeight: 1080,
        currentTime: 12.5,
        getBoundingClientRect: () =>
          ({
            left: 100,
            top: 50,
            right: 900,
            bottom: 500,
            width: 800,
            height: 450,
          }) as DOMRect,
      },
      { x: 300, y: 140 },
      { x: 700, y: 365 },
    );

    expect(target?.anchorPayload).toEqual({
      timeSeconds: 12.5,
      x: 0.25,
      y: 0.2,
      width: 0.5,
      height: 0.5,
      sourceWidth: 1920,
      sourceHeight: 1080,
    });
  });

  it('dismisses a completed frame region only outside its real bounds', () => {
    const target = createVideoFrameRegionFromClientPoints(
      {
        videoWidth: 1_920,
        videoHeight: 1_080,
        currentTime: 12.5,
        getBoundingClientRect: () =>
          ({
            left: 100,
            top: 50,
            right: 900,
            bottom: 500,
            width: 800,
            height: 450,
          }) as DOMRect,
      },
      { x: 300, y: 140 },
      { x: 700, y: 365 },
    );
    expect(target).toBeDefined();
    const video = {
      getBoundingClientRect: () =>
        ({
          left: 100,
          top: 50,
          right: 900,
          bottom: 500,
          width: 800,
          height: 450,
        }) as DOMRect,
    };
    expect(
      isClientPointInsideVideoFrameRegion(video, target!, { x: 500, y: 250 }),
    ).toBe(true);
    expect(
      isClientPointInsideVideoFrameRegion(video, target!, { x: 150, y: 75 }),
    ).toBe(false);
  });

  it('renders the native video element without exposing its file path', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
      sourceRevision: '100',
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
