import { describe, expect, it, vi } from 'vitest';

import type { AgentProviderCredentialSnapshot } from '../../shared/agent-providers';
import type { SettingsRepository } from '../settings/settings-repository';
import type { AgentProviderApi } from './agent-provider';
import { AgentProviderRegistry } from './agent-provider-registry';
import { AgentProviderService } from './agent-provider-service';

function createSettings(selected: string | null = null) {
  let selectedProviderId = selected;
  const updateSelectedAgentProviderId = vi.fn(
    async (providerId: string) => {
      selectedProviderId = providerId;
    },
  );
  const settings = {
    getSelectedAgentProviderId: vi.fn(() => selectedProviderId),
    updateSelectedAgentProviderId,
  } as unknown as SettingsRepository;

  return { settings, updateSelectedAgentProviderId };
}

function createProvider(
  credential: AgentProviderCredentialSnapshot,
): AgentProviderApi & {
  getCredentialState: ReturnType<typeof vi.fn>;
  startLogin: ReturnType<typeof vi.fn>;
  cancelLogin: ReturnType<typeof vi.fn>;
} {
  return {
    id: 'codex',
    displayName: 'Codex',
    description: 'OpenAI Codex',
    loginLabel: '使用 ChatGPT 登录',
    getCredentialState: vi.fn(async () => credential),
    startLogin: vi.fn(async () => ({
      type: 'external-browser' as const,
      providerId: 'codex',
      loginId: 'login-1',
      url: 'https://chatgpt.com/login',
    })),
    cancelLogin: vi.fn(async () => undefined),
  };
}

function createService(
  provider: AgentProviderApi,
  selectedProviderId: string | null = null,
) {
  const registry = new AgentProviderRegistry();
  registry.register(provider);
  const { settings, updateSelectedAgentProviderId } =
    createSettings(selectedProviderId);
  const warn = vi.fn();

  return {
    service: new AgentProviderService(settings, registry, {
      logger: { warn },
    }),
    updateSelectedAgentProviderId,
    warn,
  };
}

describe('AgentProviderService', () => {
  it('requires setup until the selected Provider is authenticated', async () => {
    const unauthenticated = createProvider({
      status: 'unauthenticated',
    });
    const { service } = createService(unauthenticated, 'codex');

    await expect(service.getSetup()).resolves.toMatchObject({
      selectedProviderId: 'codex',
      activeProviderId: null,
      requiresSelection: true,
      providers: [
        {
          id: 'codex',
          selected: true,
          credential: { status: 'unauthenticated' },
        },
      ],
    });
  });

  it('ignores a previously selected Provider that is no longer registered', async () => {
    const provider = createProvider({
      status: 'authenticated',
      account: {},
    });
    const { service } = createService(provider, 'removed-provider');

    await expect(service.getSetup()).resolves.toMatchObject({
      selectedProviderId: null,
      activeProviderId: null,
      requiresSelection: true,
      providers: [{ id: 'codex', selected: false }],
    });
  });

  it('refuses selection until a fresh credential check succeeds', async () => {
    const provider = createProvider({
      status: 'unauthenticated',
    });
    const { service, updateSelectedAgentProviderId } =
      createService(provider);

    await expect(service.selectProvider('codex')).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_AUTH_REQUIRED',
    });
    expect(provider.getCredentialState).toHaveBeenCalledWith(true);
    expect(updateSelectedAgentProviderId).not.toHaveBeenCalled();
  });

  it('persists and activates only an authenticated Provider', async () => {
    const provider = createProvider({
      status: 'authenticated',
      account: {
        email: 'student@example.com',
        planType: 'plus',
      },
    });
    const { service, updateSelectedAgentProviderId } =
      createService(provider);

    const setup = await service.selectProvider('codex');

    expect(updateSelectedAgentProviderId).toHaveBeenCalledWith('codex');
    expect(setup).toMatchObject({
      selectedProviderId: 'codex',
      activeProviderId: 'codex',
      requiresSelection: false,
    });
  });

  it('isolates credential check failures per Provider', async () => {
    const provider = createProvider({
      status: 'unauthenticated',
    });
    provider.getCredentialState.mockRejectedValue(
      new Error('runtime failed'),
    );
    const { service, warn } = createService(provider);

    await expect(service.getSetup()).resolves.toMatchObject({
      activeProviderId: null,
      providers: [
        {
          credential: {
            status: 'unavailable',
          },
        },
      ],
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('delegates the Provider-owned login ceremony', async () => {
    const provider = createProvider({
      status: 'unauthenticated',
    });
    const { service } = createService(provider);

    await expect(service.startLogin('codex')).resolves.toMatchObject({
      type: 'external-browser',
      providerId: 'codex',
      loginId: 'login-1',
    });
    await service.cancelLogin('codex', 'login-1');
    expect(provider.startLogin).toHaveBeenCalledOnce();
    expect(provider.cancelLogin).toHaveBeenCalledWith('login-1');
  });
});
