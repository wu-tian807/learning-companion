import { describe, expect, it, vi } from 'vitest';

import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_FACILITY_VERSION,
  createCoreWorkbenchFacilityDefinitionRegistry,
} from '../../shared/workbench/facilities/core-facilities';
import { MainFacilityAdapterRegistry } from '../../main/workbench/interaction/main-facility-adapter-registry';
import { SANDBOX_CONTEXT_MENU_TRIGGER } from '../../main/workbench/interaction/sandbox-frame-interaction-triggers';
import { WorkbenchRegistry } from '../../main/workbench/workbench-registry';
import type { RendererWorkbenchLoader } from '../../renderer/workbench/renderer-workbench-registry';
import type { AssetWorkbenchManifest } from '../../shared/workbench/manifest';
import { UnsupportedWorkbenchProvider } from '../unsupported/main';
import {
  builtinWorkbenchCatalog,
  builtinWorkbenchIds,
} from './builtin-workbenches';
import { registerMainWorkbenches } from './register-main-workbenches';
import { registerRendererWorkbenches } from './register-renderer-workbenches';

describe('builtin Workbench catalog', () => {
  it('contains unique IDs that agree with every Manifest', () => {
    expect(new Set(builtinWorkbenchIds).size).toBe(
      builtinWorkbenchIds.length,
    );

    for (const entry of builtinWorkbenchCatalog) {
      expect(entry.manifest.id).toBe(entry.id);
    }
  });

  it('registers every catalog entry in Main', () => {
    const facilityRegistry =
      createCoreWorkbenchFacilityDefinitionRegistry();
    const registry = new WorkbenchRegistry(
      new UnsupportedWorkbenchProvider(),
      facilityRegistry,
    );
    const facilityAdapterRegistry =
      new MainFacilityAdapterRegistry(facilityRegistry);

    registerMainWorkbenches(registry, {
      associationService: {} as never,
      artifactService: {} as never,
      contentResourceService: {} as never,
      externalLibraryService: {} as never,
      facilityAdapterRegistry,
      frameScriptExecutor: {} as never,
      projectLookup: {} as never,
      stateDatabase: {} as never,
      stateDataDatabase: {} as never,
    });

    for (const entry of builtinWorkbenchCatalog) {
      expect(registry.get(entry.id)?.manifest).toBe(entry.manifest);
    }
    expect(
      facilityAdapterRegistry.get(
        'builtin.html',
        CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
        CORE_FACILITY_VERSION,
        SANDBOX_CONTEXT_MENU_TRIGGER,
      )?.workbenchId,
    ).toBe('builtin.html');
  });

  it('registers lazy Renderer loaders for every catalog entry', () => {
    const loaders = new Map<
      string,
      {
        manifest: AssetWorkbenchManifest;
        loader: RendererWorkbenchLoader;
      }
    >();
    const registerLoader = vi.fn(
      (
        manifest: AssetWorkbenchManifest,
        loader: RendererWorkbenchLoader,
      ) => {
        loaders.set(manifest.id, { manifest, loader });
      },
    );

    registerRendererWorkbenches({ registerLoader });

    expect([...loaders.keys()]).toEqual(builtinWorkbenchIds);
    expect(registerLoader).toHaveBeenCalledTimes(
      builtinWorkbenchIds.length,
    );
    expect(
      [...loaders.values()].every(
        ({ manifest, loader }) =>
          manifest ===
            builtinWorkbenchCatalog.find(
              (entry) => entry.id === manifest.id,
            )?.manifest && typeof loader === 'function',
      ),
    ).toBe(true);
  });
});
