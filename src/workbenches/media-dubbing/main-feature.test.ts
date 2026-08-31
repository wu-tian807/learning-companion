import { describe, expect, it, vi } from 'vitest';

import type { ExternalLibraryServiceApi } from '../../main/external-libraries/external-library-service';
import {
  mediaDubbingMainFeature,
  resolveMediaDubbingRuntime,
} from './main-feature';

describe('media dubbing Main feature lifecycle', () => {
  it('registers the component with its installation-time runtime setup', () => {
    const registerLibrary = vi.fn();
    const registerLifecycle = vi.fn();
    const registerRuntimeSetup = vi.fn();

    mediaDubbingMainFeature.registerExternalLibraries?.({
      libraries: { register: registerLibrary },
      lifecycles: { register: registerLifecycle },
      runtimeSetups: { register: registerRuntimeSetup },
    } as never);

    expect(registerLibrary).toHaveBeenCalledOnce();
    expect(registerRuntimeSetup.mock.calls[0]?.[0].libraryId).toBe(
      'video-dubbing-voxcpm2',
    );
    expect(registerLifecycle.mock.calls[0]?.[0].libraryId).toBe(
      'video-dubbing-voxcpm2',
    );
  });

  it('connects component removal to the app-scoped VoxCPM2 resolver', async () => {
    const registerLifecycle = vi.fn();
    const externalLibraries = {
      requireRuntime: vi.fn(),
    } as unknown as ExternalLibraryServiceApi;
    const resolver = resolveMediaDubbingRuntime(externalLibraries);
    const releaseRuntime = vi
      .spyOn(resolver, 'releaseRuntime')
      .mockResolvedValue();

    mediaDubbingMainFeature.registerExternalLibraries?.({
      libraries: { register: vi.fn() },
      lifecycles: { register: registerLifecycle },
      runtimeSetups: { register: vi.fn() },
    } as never);
    const lifecycle = registerLifecycle.mock.calls[0]?.[0];
    await lifecycle.release();

    expect(releaseRuntime).toHaveBeenCalledOnce();
    const runtime = mediaDubbingMainFeature.start?.({
      externalLibraries,
    } as never);
    runtime?.dispose();
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
