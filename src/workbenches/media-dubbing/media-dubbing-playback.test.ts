import { describe, expect, it } from 'vitest';

import type { MediaDubbingSnapshot } from './contracts';
import {
  isMediaDubbingPlaybackAvailable,
  resolveMediaDubbingPlayback,
} from './media-dubbing-playback';

const preview: MediaDubbingSnapshot = {
  phase: 'cloning',
  completedPhrases: 3,
  totalPhrases: 8,
  completedDurationMs: 8_000,
  durationMs: 20_000,
  readySuffixStartMs: 12_000,
  previewAudioUrl: 'learning-content://resource/preview',
};

describe('resolveMediaDubbingPlayback', () => {
  it('keeps the original audio before the generated suffix reaches playback', () => {
    expect(resolveMediaDubbingPlayback(preview, true, 11_999)).toEqual({
      kind: 'original',
    });
  });

  it('switches to the playable suffix exactly when the two heads meet', () => {
    const playback = resolveMediaDubbingPlayback(preview, true, 12_000);

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
      resolveMediaDubbingPlayback(
        { ...preview, previewAudioUrl: undefined },
        true,
        18_000,
      ),
    ).toEqual({ kind: 'original' });
  });

  it('uses the committed full track after generation completes', () => {
    expect(
      resolveMediaDubbingPlayback(
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

      expect(isMediaDubbingPlaybackAvailable(durable)).toBe(true);
      expect(resolveMediaDubbingPlayback(durable, true, 18_000)).toMatchObject({
        kind: 'preview',
        revision: 3,
      });
    },
  );

  it('returns to original audio when dubbing is disabled', () => {
    expect(resolveMediaDubbingPlayback(preview, false, 18_000)).toEqual({
      kind: 'original',
    });
  });
});
