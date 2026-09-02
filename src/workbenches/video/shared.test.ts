import { describe, expect, it } from 'vitest';

import {
  cloneVideoSubtitleSnapshot,
  cloneVideoDubbingSnapshot,
  createVideoGetDubbingSnapshotCommand,
  createVideoGetSubtitleSnapshotCommand,
  createVideoSaveViewStateCommand,
  createVideoTimeRangeTarget,
  DEFAULT_VIDEO_SUBTITLE_VIEW_STATE,
  EMPTY_VIDEO_DUBBING_SNAPSHOT,
  EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
  DEFAULT_VIDEO_VIEW_STATE,
  isVideoSaveViewStatePayload,
  isVideoDubbingSnapshot,
  isVideoTimeRangeAnchorV1,
  isVideoWorkbenchPayload,
  isVideoWorkbenchViewState,
  videoWorkbenchManifest,
} from './shared';

describe('Video Workbench shared protocol', () => {
  it('declares native browser video formats and stream access', () => {
    expect(videoWorkbenchManifest.supportedMediaTypes).toEqual([
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/quicktime',
    ]);
    expect(videoWorkbenchManifest.requiredContentCapabilities).toEqual([
      'read-stream',
    ]);
  });

  it('validates bootstrap, view state and commands', () => {
    expect(isVideoWorkbenchViewState(DEFAULT_VIDEO_VIEW_STATE)).toBe(true);
    expect(
      isVideoWorkbenchPayload({
        contentUrl: 'learning-content://resource/token',
        sourceRevision: '100',
        viewState: DEFAULT_VIDEO_VIEW_STATE,
        subtitleState: DEFAULT_VIDEO_SUBTITLE_VIEW_STATE,
        subtitleSnapshot: EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
        dubbingSnapshot: EMPTY_VIDEO_DUBBING_SNAPSHOT,
      }),
    ).toBe(true);
    expect(
      isVideoSaveViewStatePayload(
        createVideoSaveViewStateCommand(DEFAULT_VIDEO_VIEW_STATE).payload,
      ),
    ).toBe(true);
  });

  it('declares a command for reconciling the current subtitle snapshot', () => {
    expect(createVideoGetSubtitleSnapshotCommand()).toEqual({
      type: 'video:get-subtitle-snapshot',
    });
  });

  it('validates and clones transport-safe reverse dubbing progress', () => {
    const snapshot = {
      phase: 'cloning' as const,
      completedPhrases: 2,
      totalPhrases: 5,
      completedDurationMs: 4_000,
      durationMs: 12_000,
      readySuffixStartMs: 8_000,
      previewAudioUrl: 'learning-content://resource/preview',
    };

    expect(isVideoDubbingSnapshot(snapshot)).toBe(true);
    expect(cloneVideoDubbingSnapshot(snapshot)).toEqual(snapshot);
    expect(createVideoGetDubbingSnapshotCommand()).toEqual({
      type: 'video:get-dubbing-snapshot',
    });
    expect(
      isVideoDubbingSnapshot({
        ...snapshot,
        readySuffixStartMs: 13_000,
      }),
    ).toBe(false);
    expect(
      isVideoDubbingSnapshot({
        ...snapshot,
        phase: 'ready',
        audioUrl: 'file:///private/dubbed.m4a',
      }),
    ).toBe(false);
    expect(
      isVideoDubbingSnapshot({
        ...snapshot,
        previewAudioUrl: 'file:///private/preview.wav',
      }),
    ).toBe(false);
  });

  it('rejects unsafe URLs and invalid playback state', () => {
    expect(
      isVideoWorkbenchPayload({
        contentUrl: 'file:///private/video.mp4',
        viewState: DEFAULT_VIDEO_VIEW_STATE,
      }),
    ).toBe(false);
    expect(
      isVideoWorkbenchViewState({
        ...DEFAULT_VIDEO_VIEW_STATE,
        volume: 2,
      }),
    ).toBe(false);
  });

  it('omits undefined optional fields when cloning subtitle snapshots', () => {
    const snapshot = cloneVideoSubtitleSnapshot({
      ...EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
      source: undefined,
      translation: undefined,
      message: undefined,
    });

    expect(snapshot).toEqual(EMPTY_VIDEO_SUBTITLE_SNAPSHOT);
    expect(Object.hasOwn(snapshot, 'source')).toBe(false);
    expect(Object.hasOwn(snapshot, 'translation')).toBe(false);
    expect(Object.hasOwn(snapshot, 'message')).toBe(false);
  });

  it('creates a validated time-range anchor', () => {
    const target = createVideoTimeRangeTarget(12.5, 18);

    expect(target.targetType).toBe('video.time-range');
    expect(isVideoTimeRangeAnchorV1(target.targetPayload)).toBe(true);
    expect(
      isVideoTimeRangeAnchorV1({
        startSeconds: 20,
        endSeconds: 10,
      }),
    ).toBe(false);
  });
});
