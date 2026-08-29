import { describe, expect, it, vi } from 'vitest';

import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import { EMPTY_MEDIA_DUBBING_SNAPSHOT } from './contracts';
import { MediaDubbingSessionResources } from './media-dubbing-session-resources';

function resources(): ContentResourceServiceApi {
  let next = 0;
  return {
    register: vi.fn(() => `learning-content://resource/${++next}`),
    revokeSession: vi.fn(),
    handle: vi.fn(async () => new Response()),
    dispose: vi.fn(),
  };
}

describe('MediaDubbingSessionResources', () => {
  it('reuses one preview registration and replaces it with the final artifact', async () => {
    const contentResources = resources();
    const session = new MediaDubbingSessionResources(
      'session',
      contentResources,
      EMPTY_MEDIA_DUBBING_SNAPSHOT,
    );
    const preview = {
      phase: 'cloning' as const,
      completedPhrases: 2,
      totalPhrases: 4,
      completedDurationMs: 2_000,
      durationMs: 4_000,
      readySuffixStartMs: 2_000,
      previewAudioPath: 'D:/project/preview.wav',
    };

    expect(session.attach(preview)).toMatchObject({
      previewAudioUrl: 'learning-content://resource/1',
    });
    session.attach({ ...preview, completedPhrases: 3 });
    expect(contentResources.register).toHaveBeenCalledTimes(1);

    const finalSnapshot = session.attach({
        phase: 'ready',
        completedPhrases: 4,
        totalPhrases: 4,
        completedDurationMs: 4_000,
        durationMs: 4_000,
        readySuffixStartMs: 0,
        artifactPath: 'D:/project/dubbed.m4a',
        artifactRevision: 'artifact-revision',
      });
    expect(finalSnapshot).toMatchObject({
      audioUrl: 'learning-content://resource/2',
    });
    expect(finalSnapshot.previewAudioUrl).toBeUndefined();
    expect(contentResources.register).toHaveBeenLastCalledWith(
      'session',
      expect.anything(),
      'audio/mp4',
    );

    await expect(session.close()).resolves.toBeUndefined();
  });
});
