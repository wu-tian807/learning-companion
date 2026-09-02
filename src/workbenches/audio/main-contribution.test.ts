import { describe, expect, it, vi } from 'vitest';

import type { MainWorkbenchProviderContext } from '../../main/workbench/main-workbench-contribution';
import { audioMainWorkbenchContribution } from './main-contribution';
import { audioWorkbenchManifest } from './shared';

describe('audioMainWorkbenchContribution', () => {
  it('assembles Audio with shared media services without owning global features', () => {
    const subscribeAssets = vi.fn(() => () => undefined);
    const subscribeTasks = vi.fn(() => () => undefined);
    const context: MainWorkbenchProviderContext = {
      associationService: {} as never,
      assetService: { subscribe: subscribeAssets } as never,
      artifactRegistry: {} as never,
      artifactService: {} as never,
      contentResourceService: {} as never,
      externalLibraryService: {} as never,
      generationTasks: { subscribe: subscribeTasks } as never,
      projectLookup: {} as never,
      stateDatabase: {} as never,
      stateDataDatabase: {} as never,
      sandboxFrameScripts: {} as never,
      workbenchEvents: {} as never,
    };

    const provider = audioMainWorkbenchContribution.createProvider?.(context);

    expect(provider?.manifest).toBe(audioWorkbenchManifest);
    expect(audioMainWorkbenchContribution.features?.map(({ id }) => id)).toEqual([
      'builtin.audio.targets',
    ]);
    expect(subscribeAssets).toHaveBeenCalledOnce();
    expect(subscribeTasks).toHaveBeenCalledOnce();
  });
});
