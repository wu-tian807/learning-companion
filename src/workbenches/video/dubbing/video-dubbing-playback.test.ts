import { describe, expect, it } from 'vitest';

import type { VideoDubbingSnapshot } from '../shared';
import {
  isVideoDubbingPlaybackAvailable,
  resolveVideoDubbingPlayback,
} from './video-dubbing-playback';

const preview: VideoDubbingSnapshot = {
  phase: 'cloning',
  completedPhrases: 3,
  totalPhrases: 8,
  completedDurationMs: 8_000,
  durationMs: 20_000,
  readySuffixStartMs: 12_000,
  previewAudioUrl: 'learning-content://resource/preview',
};

describe('resolveVideoDubbingPlayback', () => {
  it('keeps the original audio before the generated suffix reaches playback', () => {
    expect(resolveVideoDubbingPlayback(preview, true, 11_999)).toEqual({
      kind: 'original',
    });
  });

  it('switches to the playable suffix exactly when the two heads meet', () => {
    const playback = resolveVideoDubbingPlayback(preview, true, 12_000);

    expect(playback).toEqual({
      kind: 'preview',
      audioUrl: 'learning-content://resource/preview',
      revision: 3,
    });
    expect(
      playback.kind === 'preview' ? new URL(playback.audioUrl).search : '?',
    ).toBe('');
  });

  it('never treats progress without playable files as audible', () => {
    expect(
      resolveVideoDubbingPlayback(
        { ...preview, previewAudioUrl: undefined },
        true,
        18_000,
      ),
    ).toEqual({ kind: 'original' });
  });

  it('uses the committed full track after generation completes', () => {
    expect(
      resolveVideoDubbingPlayback(
        {
          ...preview,
          phase: 'ready',
          readySuffixStartMs: 0,
          audioUrl: 'learning-content://resource/final',
        },
        true,
        0,
      ),
    ).toEqual({
      kind: 'final',
      audioUrl: 'learning-content://resource/final',
    });
  });

  it.each(['interrupted', 'failed'] as const)(
    'keeps an %s task playable when its durable suffix is intact',
    (phase) => {
      const durable = { ...preview, phase };

      expect(isVideoDubbingPlaybackAvailable(durable)).toBe(true);
      expect(resolveVideoDubbingPlayback(durable, true, 18_000)).toMatchObject({
        kind: 'preview',
        revision: 3,
      });
    },
  );

  it('returns to original audio when dubbing is disabled', () => {
    expect(resolveVideoDubbingPlayback(preview, false, 18_000)).toEqual({
      kind: 'original',
    });
  });
});
