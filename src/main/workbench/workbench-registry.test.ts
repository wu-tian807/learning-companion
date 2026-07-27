import { describe, expect, it } from 'vitest';

import type { ContentCapability } from '../../shared/workbench/manifest';
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
): MainWorkbenchProvider {
  const manifest: AssetWorkbenchManifest = {
    id,
    version: 1,
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    supportedMediaTypes,
    requiredContentCapabilities,
    supportedAnchorTypes: [],
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
      ['read-text'],
    );
    const registry = new WorkbenchRegistry(fallback);
    registry.register(plainText);

    expect(
      registry.select('text/plain', createHandle(['read-text'])),
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
});
