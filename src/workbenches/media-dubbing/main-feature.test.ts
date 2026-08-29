import { describe, expect, it, vi } from 'vitest';

import type { ExternalLibraryServiceApi } from '../../main/external-libraries/external-library-service';
import {
  mediaDubbingMainFeature,
  resolveMediaDubbingRuntime,
} from './main-feature';

describe('media dubbing Main feature lifecycle', () => {
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
