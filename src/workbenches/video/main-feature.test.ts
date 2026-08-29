import { describe, expect, it, vi } from 'vitest';

import type { MainWorkbenchProviderContext } from '../../main/workbench/main-workbench-contribution';
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
      generationTasks: { subscribe: vi.fn(() => () => undefined) } as never,
      projectLookup: {} as never,
      stateDatabase: {} as never,
      stateDataDatabase: {} as never,
      sandboxFrameScripts: {} as never,
      workbenchEvents: {} as never,
    };

    const provider = videoMainContribution.createProvider?.(context);

    expect(provider?.manifest).toBe(videoWorkbenchManifest);
    expect(videoMainContribution.features?.map(({ id }) => id)).toEqual([
      'builtin.video.frame-conversation',
      'builtin.video.dubbing',
    ]);
    expect(subscribe).toHaveBeenCalledOnce();
    expect(registerArtifact).not.toHaveBeenCalled();
  });
});
