import { describe, expect, it } from 'vitest';

import type { ContentCapability } from '../../shared/workbench/manifest';
import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_FACILITY_VERSION,
} from '../../shared/workbench/facilities/core-facilities';
import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import type { ContentHandle } from '../content/content-handle';
import type { MainWorkbenchProvider } from './workbench-session';
import { WorkbenchRegistry } from './workbench-registry';

function createProvider(
  id: string,
  supportedMediaTypes: readonly string[],
  requiredContentCapabilities: readonly ContentCapability[] = [],
  selectionPriority?: number,
): MainWorkbenchProvider {
  const manifest: AssetWorkbenchManifest = {
    id,
    version: 1,
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    ...(selectionPriority === undefined
      ? {}
      : { selectionPriority }),
    supportedMediaTypes,
    requiredContentCapabilities,
    supportedTargetTypes: [],
    facilities: [],
  };

  return {
    manifest,
    open: async () => ({ payload: null }),
    command: async () => ({ payload: null }),
    close: async () => undefined,
  };
}

function createHandle(
  capabilities: readonly ContentCapability[],
): ContentHandle {
  return {
    capabilities: new Set(capabilities),
    close: async () => undefined,
  };
}

describe('WorkbenchRegistry', () => {
  it('selects an exact media provider with sufficient capabilities', () => {
    const fallback = createProvider('fallback', ['*/*']);
    const plainText = createProvider(
      'plain-text',
      ['text/plain'],
      ['read-bytes'],
    );
    const registry = new WorkbenchRegistry(fallback);
    registry.register(plainText);

    expect(
      registry.select('text/plain', createHandle(['read-bytes'])),
    ).toEqual({
      provider: plainText,
      reason: 'matched',
    });
  });

  it('distinguishes unsupported media from missing capabilities', () => {
    const fallback = createProvider('fallback', ['*/*']);
    const pdf = createProvider('pdf', ['application/pdf'], ['read-bytes']);
    const registry = new WorkbenchRegistry(fallback);
    registry.register(pdf);

    expect(
      registry.select('application/pdf', createHandle([])),
    ).toEqual({
      provider: fallback,
      reason: 'missing-capability',
    });
    expect(registry.select('text/markdown', createHandle([]))).toEqual({
      provider: fallback,
      reason: 'unsupported-media',
    });
  });

  it('prefers explicit media matches over wildcard matches', () => {
    const fallback = createProvider('fallback', ['*/*']);
    const wildcard = createProvider('wildcard', ['text/*']);
    const markdown = createProvider('markdown', ['text/markdown']);
    const registry = new WorkbenchRegistry(fallback);
    registry.register(wildcard);
    registry.register(markdown);

    expect(
      registry.select('text/markdown', createHandle([])),
    ).toEqual({
      provider: markdown,
      reason: 'matched',
    });
  });

  it('uses selection priority and rejects unresolved ties', () => {
    const fallback = createProvider('fallback', ['*/*']);
    const defaultProvider = createProvider('default', ['text/plain']);
    const preferredProvider = createProvider(
      'preferred',
      ['text/plain'],
      [],
      10,
    );
    const registry = new WorkbenchRegistry(fallback);
    registry.register(defaultProvider);
    registry.register(preferredProvider);

    expect(registry.select('text/plain', createHandle([]))).toEqual({
      provider: preferredProvider,
      reason: 'matched',
    });

    const conflictingRegistry = new WorkbenchRegistry(fallback);
    conflictingRegistry.register(
      createProvider('first', ['text/plain']),
    );
    conflictingRegistry.register(
      createProvider('second', ['text/plain']),
    );

    expect(() =>
      conflictingRegistry.select('text/plain', createHandle([])),
    ).toThrow('REGISTRATION_CONFLICT');
  });

  it('rejects duplicate IDs and invalid manifests', () => {
    const fallback = createProvider('fallback', ['*/*']);
    const registry = new WorkbenchRegistry(fallback);

    expect(() => registry.register(fallback)).toThrow(
      'REGISTRATION_CONFLICT',
    );
    expect(() =>
      registry.register({
        ...createProvider('invalid', ['text/plain']),
        manifest: {
          ...createProvider('invalid', ['text/plain']).manifest,
          version: 0,
        },
      }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
  });

  it('rejects Facility adapters that the provider manifest does not own', () => {
    const fallback = createProvider('fallback', ['*/*']);
    const registry = new WorkbenchRegistry(fallback);
    const provider = createProvider('html', ['text/html']);

    expect(() => registry.register({
      ...provider,
      facilityAdapters: [{
        workbenchId: provider.manifest.id,
        facilityId: CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
        facilityVersion: CORE_FACILITY_VERSION,
        triggers: ['context-menu'],
        capture: () => ({}),
      }],
    })).toThrow('INVALID_EXTENSION_DEFINITION');
  });
});
