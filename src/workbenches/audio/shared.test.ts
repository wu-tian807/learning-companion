import { describe, expect, it } from 'vitest';

import {
  audioWorkbenchManifest,
  createAudioGetDubbingSnapshotCommand,
  createAudioGetSpeakerTrackCommand,
  createAudioGetSubtitleSnapshotCommand,
  createAudioRetryDubbingCommand,
  createAudioRetrySubtitlesCommand,
  createAudioSaveViewStateCommand,
  createAudioSetSubtitleModeCommand,
  createAudioStartDubbingCommand,
  createAudioTimeRangeTarget,
  DEFAULT_AUDIO_SUBTITLE_VIEW_STATE,
  DEFAULT_AUDIO_VIEW_STATE,
  EMPTY_AUDIO_DUBBING_SNAPSHOT,
  EMPTY_AUDIO_SPEAKER_TRACK_SNAPSHOT,
  EMPTY_AUDIO_SUBTITLE_SNAPSHOT,
  isAudioSaveViewStatePayload,
  isAudioTimeRangeAnchorV1,
  isAudioWorkbenchPayload,
  isAudioWorkbenchStateV1,
  isAudioWorkbenchStateV2,
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
        subtitleState: DEFAULT_AUDIO_SUBTITLE_VIEW_STATE,
        subtitleSnapshot: EMPTY_AUDIO_SUBTITLE_SNAPSHOT,
        dubbingSnapshot: EMPTY_AUDIO_DUBBING_SNAPSHOT,
        speakerTrackSnapshot: EMPTY_AUDIO_SPEAKER_TRACK_SNAPSHOT,
      }),
    ).toBe(true);
    expect(
      isAudioSaveViewStatePayload(
        createAudioSaveViewStateCommand(DEFAULT_AUDIO_VIEW_STATE)
          .payload,
      ),
    ).toBe(true);
    expect(
      isAudioWorkbenchStateV1({ viewState: DEFAULT_AUDIO_VIEW_STATE }),
    ).toBe(true);
    expect(
      isAudioWorkbenchStateV2({
        viewState: DEFAULT_AUDIO_VIEW_STATE,
        subtitleState: DEFAULT_AUDIO_SUBTITLE_VIEW_STATE,
      }),
    ).toBe(true);
    expect([
      createAudioSetSubtitleModeCommand('bilingual').type,
      createAudioGetSubtitleSnapshotCommand().type,
      createAudioRetrySubtitlesCommand().type,
      createAudioStartDubbingCommand().type,
      createAudioGetDubbingSnapshotCommand().type,
      createAudioRetryDubbingCommand().type,
      createAudioGetSpeakerTrackCommand().type,
    ]).toEqual([
      'audio:set-subtitle-mode',
      'audio:get-subtitle-snapshot',
      'audio:retry-subtitles',
      'audio:start-dubbing',
      'audio:get-dubbing-snapshot',
      'audio:retry-dubbing',
      'audio:get-speaker-track',
    ]);
  });

  it('rejects unsafe URLs and invalid playback state', () => {
    expect(
      isAudioWorkbenchPayload({
        contentUrl: 'file:///private/audio.mp3',
        viewState: DEFAULT_AUDIO_VIEW_STATE,
        subtitleState: DEFAULT_AUDIO_SUBTITLE_VIEW_STATE,
        subtitleSnapshot: EMPTY_AUDIO_SUBTITLE_SNAPSHOT,
        dubbingSnapshot: EMPTY_AUDIO_DUBBING_SNAPSHOT,
        speakerTrackSnapshot: EMPTY_AUDIO_SPEAKER_TRACK_SNAPSHOT,
      }),
    ).toBe(false);
    expect(
      isAudioWorkbenchViewState({
        ...DEFAULT_AUDIO_VIEW_STATE,
        playbackRate: 5,
      }),
    ).toBe(false);
  });

  it('validates the optional speaker track at the bootstrap boundary', () => {
    const payload = {
      contentUrl: 'learning-content://resource/token',
      viewState: DEFAULT_AUDIO_VIEW_STATE,
      subtitleState: DEFAULT_AUDIO_SUBTITLE_VIEW_STATE,
      subtitleSnapshot: EMPTY_AUDIO_SUBTITLE_SNAPSHOT,
      dubbingSnapshot: EMPTY_AUDIO_DUBBING_SNAPSHOT,
      speakerTrackSnapshot: {
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
      },
    };
    expect(isAudioWorkbenchPayload(payload)).toBe(true);
    expect(
      isAudioWorkbenchPayload({
        ...payload,
        speakerTrackSnapshot: {
          track: {
            ...payload.speakerTrackSnapshot.track,
            cues: [
              ...payload.speakerTrackSnapshot.track.cues,
              ...payload.speakerTrackSnapshot.track.cues,
            ],
          },
        },
      }),
    ).toBe(false);
  });

  it('creates a validated time-range anchor', () => {
    const target = createAudioTimeRangeTarget(12.5, 18);

    expect(target.targetType).toBe('audio.time-range');
    expect(isAudioTimeRangeAnchorV1(target.targetPayload)).toBe(true);
    expect(
      isAudioTimeRangeAnchorV1({
        startSeconds: 20,
        endSeconds: 10,
      }),
    ).toBe(false);
  });
});
