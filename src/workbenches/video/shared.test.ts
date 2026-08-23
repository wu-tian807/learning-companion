import { describe, expect, it } from 'vitest';

import {
  cloneVideoSubtitleSnapshot,
  createVideoGetSubtitleSnapshotCommand,
  createVideoSaveViewStateCommand,
  createVideoTimeRangeTarget,
  DEFAULT_VIDEO_SUBTITLE_VIEW_STATE,
  EMPTY_VIDEO_SUBTITLE_SNAPSHOT,
  DEFAULT_VIDEO_VIEW_STATE,
  isVideoSaveViewStatePayload,
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

    expect(target.anchorType).toBe('video.time-range');
    expect(isVideoTimeRangeAnchorV1(target.anchorPayload)).toBe(true);
    expect(
      isVideoTimeRangeAnchorV1({
        startSeconds: 20,
        endSeconds: 10,
      }),
    ).toBe(false);
  });
});
