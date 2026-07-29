import { describe, expect, it } from 'vitest';

import {
  isAssetWorkbenchManifest,
  WORKBENCH_PROTOCOL_VERSION,
} from './manifest';

describe('AssetWorkbenchManifest', () => {
  it('accepts a valid unique manifest', () => {
    expect(
      isAssetWorkbenchManifest({
        id: 'builtin.markdown',
        version: 1,
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        supportedMediaTypes: ['text/markdown'],
        requiredContentCapabilities: ['read-bytes'],
        supportedAnchorTypes: ['markdown.text-range'],
        facilities: [],
      }),
    ).toBe(true);
  });

  it('rejects invalid versions and duplicate capabilities', () => {
    expect(
      isAssetWorkbenchManifest({
        id: 'builtin.markdown',
        version: 0,
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        supportedMediaTypes: ['text/markdown'],
        requiredContentCapabilities: [],
        supportedAnchorTypes: [],
        facilities: [],
      }),
    ).toBe(false);
    expect(
      isAssetWorkbenchManifest({
        id: 'builtin.markdown',
        version: 1,
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        supportedMediaTypes: ['text/markdown'],
        requiredContentCapabilities: ['read-bytes', 'read-bytes'],
        supportedAnchorTypes: [],
        facilities: [],
      }),
    ).toBe(false);
  });

  it('rejects invalid or duplicate facility declarations', () => {
    const base = {
      id: 'builtin.markdown',
      version: 1,
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      supportedMediaTypes: ['text/markdown'],
      requiredContentCapabilities: [],
      supportedAnchorTypes: [],
    };

    expect(
      isAssetWorkbenchManifest({
        ...base,
        facilities: [{ id: 'invalid', version: 1 }],
      }),
    ).toBe(false);
    expect(
      isAssetWorkbenchManifest({
        ...base,
        facilities: [
          { id: 'core.transport.renderer', version: 1 },
          { id: 'core.transport.renderer', version: 1 },
        ],
      }),
    ).toBe(false);
  });
});
