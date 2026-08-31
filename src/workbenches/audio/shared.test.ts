import { describe, expect, it } from 'vitest';

import {
  audioWorkbenchManifest,
  createAudioSaveViewStateCommand,
  createAudioTimeRangeTarget,
  DEFAULT_AUDIO_VIEW_STATE,
  isAudioSaveViewStatePayload,
  isAudioTimeRangeAnchorV1,
  isAudioWorkbenchPayload,
  isAudioWorkbenchViewState,
} from './shared';

describe('Audio Workbench shared protocol', () => {
  it('declares common browser audio formats and stream access', () => {
    expect(audioWorkbenchManifest.supportedMediaTypes).toEqual([
      'audio/mpeg',
      'audio/wav',
      'audio/mp4',
      'audio/aac',
      'audio/flac',
      'audio/ogg',
      'audio/webm',
    ]);
    expect(audioWorkbenchManifest.requiredContentCapabilities).toEqual([
      'read-stream',
    ]);
  });

  it('validates bootstrap, view state and commands', () => {
    expect(isAudioWorkbenchViewState(DEFAULT_AUDIO_VIEW_STATE)).toBe(true);
    expect(
      isAudioWorkbenchPayload({
        contentUrl: 'learning-content://resource/token',
        viewState: DEFAULT_AUDIO_VIEW_STATE,
      }),
    ).toBe(true);
    expect(
      isAudioSaveViewStatePayload(
        createAudioSaveViewStateCommand(DEFAULT_AUDIO_VIEW_STATE)
          .payload,
      ),
    ).toBe(true);
  });

  it('rejects unsafe URLs and invalid playback state', () => {
    expect(
      isAudioWorkbenchPayload({
        contentUrl: 'file:///private/audio.mp3',
        viewState: DEFAULT_AUDIO_VIEW_STATE,
      }),
    ).toBe(false);
    expect(
      isAudioWorkbenchViewState({
        ...DEFAULT_AUDIO_VIEW_STATE,
        playbackRate: 5,
      }),
    ).toBe(false);
  });

  it('creates a validated time-range anchor', () => {
    const target = createAudioTimeRangeTarget(12.5, 18);

    expect(target.anchorType).toBe('audio.time-range');
    expect(isAudioTimeRangeAnchorV1(target.anchorPayload)).toBe(true);
    expect(
      isAudioTimeRangeAnchorV1({
        startSeconds: 20,
        endSeconds: 10,
      }),
    ).toBe(false);
  });
});
