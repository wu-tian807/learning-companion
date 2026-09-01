import { describe, expect, it, vi } from 'vitest';

import { mediaSubtitlesMainFeature } from './main-feature';
import { MEDIA_SUBTITLE_SRT_PRODUCER_ID } from './subtitle-srt-artifact';

describe('mediaSubtitlesMainFeature', () => {
  it('registers the generic SRT projection beside source and translation producers', () => {
    const register = vi.fn();

    mediaSubtitlesMainFeature.registerArtifactProducers?.({
      artifacts: { register } as never,
      externalLibraries: {} as never,
      externalLibraryProfilesDirectory: 'unused',
    });

    expect(
      register.mock.calls.map(([producer]) => producer.id),
    ).toContain(MEDIA_SUBTITLE_SRT_PRODUCER_ID);
  });
});
