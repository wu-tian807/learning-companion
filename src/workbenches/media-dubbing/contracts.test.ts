import { describe, expect, it } from 'vitest';

import {
  EMPTY_MEDIA_DUBBING_SNAPSHOT,
  isMediaDubbingSnapshot,
} from './contracts';

describe('media dubbing presentation protocol', () => {
  it('accepts a durable generated suffix', () => {
    expect(
      isMediaDubbingSnapshot({
        phase: 'cloning',
        completedPhrases: 3,
        totalPhrases: 8,
        completedDurationMs: 8_000,
        durationMs: 20_000,
        readySuffixStartMs: 12_000,
        previewAudioUrl: 'learning-content://resource/preview',
      }),
    ).toBe(true);
  });

  it('rejects unsafe URLs and suffixes outside the media duration', () => {
    expect(
      isMediaDubbingSnapshot({
        ...EMPTY_MEDIA_DUBBING_SNAPSHOT,
        phase: 'ready',
        audioUrl: 'file:///private/dubbed.m4a',
      }),
    ).toBe(false);
    expect(
      isMediaDubbingSnapshot({
        ...EMPTY_MEDIA_DUBBING_SNAPSHOT,
        phase: 'cloning',
        durationMs: 10_000,
        readySuffixStartMs: 11_000,
      }),
    ).toBe(false);
  });
});
