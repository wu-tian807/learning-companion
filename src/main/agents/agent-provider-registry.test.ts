import { describe, expect, it, vi } from 'vitest';

import type { AgentProvider } from './agent-provider';
import { AgentProviderRegistry } from './agent-provider-registry';

function provider(id: string): AgentProvider {
  return {
    id,
    providerId: id,
    displayName: id,
    description: '',
    loginLabel: '登录',
    getCredentialState: vi.fn(async () => ({
      status: 'unauthenticated' as const,
    })),
    startLogin: vi.fn(),
    cancelLogin: vi.fn(),
    async *runTurn() {
      yield* [] as never[];
      throw new Error('not used');
    },
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
