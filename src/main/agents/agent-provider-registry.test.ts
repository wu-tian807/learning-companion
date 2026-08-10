import { describe, expect, it, vi } from 'vitest';

import type { AgentProvider } from './agent-provider';
import { AgentProviderRegistry } from './agent-provider-registry';

function provider(id: string): AgentProvider {
  return {
    id,
    displayName: id,
    description: '',
    supportedConnectionKinds: ['account'],
    builtInConnections: [{
      id: `${id}-account`,
      providerId: id,
      kind: 'account',
      displayName: 'Account',
    }],
    inspectAccountConnection: vi.fn(async () => ({
      status: 'unconfigured' as const,
    })),
    startLogin: vi.fn(),
    cancelLogin: vi.fn(),
    getModelCatalog: vi.fn(async () => ({
      providerId: id,
      connectionId: `${id}-account`,
      allowsCustomModel: false,
      models: [],
    })),
    createRunner: vi.fn(),
  };
}

describe('AgentProviderRegistry', () => {
  it('registers Providers by stable id', () => {
    const registry = new AgentProviderRegistry();
    const codex = provider('codex');

    registry.register(codex);

    expect(registry.list()).toEqual([codex]);
    expect(registry.require('codex')).toBe(codex);
  });

  it('rejects duplicate and unknown Providers', () => {
    const registry = new AgentProviderRegistry();
    registry.register(provider('codex'));

    expect(() => registry.register(provider('codex'))).toThrow();
    expect(() => registry.require('missing')).toThrow();
  });
});
