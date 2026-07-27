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
        requiredContentCapabilities: ['read-text'],
        supportedAnchorTypes: ['markdown.text-range'],
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
      }),
    ).toBe(false);
    expect(
      isAssetWorkbenchManifest({
        id: 'builtin.markdown',
        version: 1,
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        supportedMediaTypes: ['text/markdown'],
        requiredContentCapabilities: ['read-text', 'read-text'],
        supportedAnchorTypes: [],
      }),
    ).toBe(false);
  });
});
