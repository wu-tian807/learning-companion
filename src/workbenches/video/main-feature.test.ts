import { describe, expect, it, vi } from 'vitest';

import type { MainWorkbenchProviderContext } from '../catalog/register-main-workbenches';
import { videoMainContribution } from './main-feature';
import { videoWorkbenchManifest } from './shared';

describe('videoMainContribution', () => {
  it('owns Video provider and subtitle service assembly', () => {
    const subscribe = vi.fn(() => () => undefined);
    const registerArtifact = vi.fn();
    const context: MainWorkbenchProviderContext = {
      associationService: {} as never,
      assetService: { subscribe } as never,
      artifactRegistry: { register: registerArtifact } as never,
      artifactService: {} as never,
      contentResourceService: {} as never,
      externalLibraryService: {} as never,
      projectLookup: {} as never,
      stateDatabase: {} as never,
      stateDataDatabase: {} as never,
      sandboxFrameScripts: {} as never,
      workbenchEvents: {} as never,
    };

    const provider = videoMainContribution.createProvider?.(context);

    expect(provider?.manifest).toBe(videoWorkbenchManifest);
    expect(subscribe).toHaveBeenCalledOnce();
    expect(registerArtifact).toHaveBeenCalledTimes(2);
  });
});
