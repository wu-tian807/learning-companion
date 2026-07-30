import { describe, expect, it, vi } from 'vitest';

import { AssetArtifactRegistry } from './asset-artifact-registry';

describe('AssetArtifactRegistry', () => {
  it('registers and resolves trusted Producers', () => {
    const registry = new AssetArtifactRegistry();
    const producer = {
      id: 'builtin.office.preview',
      version: '1',
      produce: vi.fn(),
    };

    registry.register(producer);

    expect(registry.get(producer.id)).toBe(producer);
    expect(registry.require(producer.id)).toBe(producer);
  });

  it('rejects duplicate and invalid Producer definitions', () => {
    const registry = new AssetArtifactRegistry();
    const producer = {
      id: 'builtin.office.preview',
      version: '1',
      produce: vi.fn(),
    };
    registry.register(producer);

    expect(() => registry.register(producer)).toThrow(
      'REGISTRATION_CONFLICT',
    );
    expect(() =>
      registry.register({
        ...producer,
        id: '../escaped',
      }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
    expect(() => registry.require('missing')).toThrow(
      'INVALID_EXTENSION_DEFINITION',
    );
  });
});
