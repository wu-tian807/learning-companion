import { describe, expect, it, vi } from 'vitest';

import type { ExternalLibraryServiceApi } from '../../main/external-libraries/external-library-service';
import {
  mediaDubbingMainFeature,
  resolveMediaDubbingRuntime,
} from './main-feature';

describe('media dubbing Main feature lifecycle', () => {
  it('registers the component with its installation-time runtime setup', () => {
    const registerLibrary = vi.fn();
    const registerRuntimeSetup = vi.fn();

    mediaDubbingMainFeature.registerExternalLibraries?.({
      libraries: { register: registerLibrary },
      runtimeSetups: { register: registerRuntimeSetup },
    } as never);

    expect(registerLibrary).toHaveBeenCalledOnce();
    expect(registerRuntimeSetup.mock.calls[0]?.[0].libraryId).toBe(
      'video-dubbing-voxcpm2',
    );
  });

  it('registers both the final audio and durable speaker-track producers', () => {
    const register = vi.fn();

    mediaDubbingMainFeature.registerArtifactProducers?.({
      artifacts: { register },
    } as never);

    expect(
      register.mock.calls.map(([producer]) => producer.id),
    ).toEqual([
      'builtin.video.dubbing.voxcpm2',
      'builtin.media-dubbing.speaker-track',
    ]);
  });

  it('shuts down and releases the app-scoped VoxCPM2 resolver', async () => {
    const externalLibraries = {
      requireRuntime: vi.fn(),
    } as unknown as ExternalLibraryServiceApi;
    const resolver = resolveMediaDubbingRuntime(externalLibraries);
    const shutdown = vi.spyOn(resolver, 'shutdown').mockResolvedValue();
    const runtime = mediaDubbingMainFeature.start?.({
      externalLibraries,
    } as never);

    await runtime?.shutdown?.();
    expect(shutdown).toHaveBeenCalledOnce();

    runtime?.dispose();
    expect(resolveMediaDubbingRuntime(externalLibraries)).not.toBe(resolver);
  });
});
