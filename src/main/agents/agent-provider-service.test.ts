import { describe, expect, it, vi } from 'vitest';

import type {
  AgentProviderConnectionConfiguration,
  AgentProviderSelectorSelectionSnapshot,
} from '../../shared/agent-providers';
import { GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID } from '../../shared/agent-provider-selectors';
import { DEFAULT_APP_PREFERENCES } from '../../shared/app-preferences';
import type { SettingsRepository } from '../settings/settings-repository';
import type { AgentProvider } from './agent-provider';
import { AgentProviderRegistry } from './agent-provider-registry';
import type { AgentProviderSecretStore } from './agent-provider-secret-file';
import { AgentProviderSelectorRegistry } from './agent-provider-selector-registry';
import { AgentProviderService } from './agent-provider-service';
import { normalizeCodexResponsesBaseUrl } from './providers/codex-responses-url';

function createSettings() {
  const connections = new Map<string, AgentProviderConnectionConfiguration>();
  const selections = new Map<
    string,
    Map<string, AgentProviderSelectorSelectionSnapshot>
  >();
  const selectorConnections = new Map<
    string,
    { providerId: string; connectionId: string }
  >();
  const settings: SettingsRepository = {
    initialize: vi.fn(async () => undefined),
    get: vi.fn(() => DEFAULT_APP_PREFERENCES),
    updateHomePreferences: vi.fn(async () => DEFAULT_APP_PREFERENCES),
    getAppSetup: vi.fn(() => ({
      currentOnboardingVersion: 2,
      completedOnboardingVersion: 2,
      pendingOnboardingStep: null,
      requiresOnboarding: false,
    } as const)),
    completeExternalLibraryOnboarding: vi.fn(),
    completeAgentProviderOnboarding: vi.fn(),
    getDefaultProjectWorkspace: vi.fn(() => 'C:\\workspace'),
    updateDefaultProjectWorkspace: vi.fn(async () => undefined),
    getExternalLibrariesPath: vi.fn(() => 'C:\\external'),
    updateExternalLibrariesPath: vi.fn(async () => undefined),
    listAgentProviderConnections: vi.fn(() => [...connections.values()]),
    getAgentProviderConnection: vi.fn((id) => connections.get(id)),
    updateAgentProviderConnection: vi.fn(async (connection) => {
      connections.set(connection.id, connection);
    }),
    deleteAgentProviderConnection: vi.fn(async (id) => {
      connections.delete(id);
      for (const [selectorId, byConnection] of selections) {
        byConnection.delete(id);
        if (byConnection.size === 0) {
          selections.delete(selectorId);
        }
      }
      for (const [selectorId, record] of selectorConnections) {
        if (record.connectionId === id) {
          selectorConnections.delete(selectorId);
        }
      }
    }),
    listAgentProviderSelectorSelections: vi.fn(() =>
      [...selections.values()].flatMap((byConnection) => [
        ...byConnection.values(),
      ]),
    ),
    getAgentProviderSelectorSelection: vi.fn((selectorId, connectionId) =>
      selections.get(selectorId)?.get(connectionId),
    ),
    updateAgentProviderSelectorSelection: vi.fn(async (selection) => {
      const byConnection = selections.get(selection.selectorId) ?? new Map();
      byConnection.set(selection.connectionId, selection);
      selections.set(selection.selectorId, byConnection);
      selectorConnections.set(selection.selectorId, {
        providerId: selection.providerId,
        connectionId: selection.connectionId,
      });
    }),
    getAgentProviderSelectorConnection: vi.fn((selectorId) =>
      selectorConnections.get(selectorId),
    ),
  };
  return { settings, connections, selections, selectorConnections };
}

function createSecrets() {
  const values = new Map<string, string>();
  const key = (providerId: string, connectionId: string) =>
    `${providerId}/${connectionId}`;
  const store: AgentProviderSecretStore = {
    get: vi.fn(async (providerId, connectionId) =>
      values.get(key(providerId, connectionId)),
    ),
    set: vi.fn(async (providerId, connectionId, secret) => {
      values.set(key(providerId, connectionId), secret);
    }),
    delete: vi.fn(async (providerId, connectionId) => {
      values.delete(key(providerId, connectionId));
    }),
  };
  return { store, values };
}

function createProvider(
  inspectAccountConnection: AgentProvider['inspectAccountConnection'] = vi.fn(
    async () => ({
      status: 'ready' as const,
      account: { email: 'student@example.com' },
    }),
  ),
): AgentProvider {
  return {
    id: 'codex',
    displayName: 'Codex',
    description: 'Codex Agent',
    supportedConnectionKinds: ['account', 'api-key'],
    builtInConnections: [
      {
        id: 'codex-account',
        providerId: 'codex',
        kind: 'account',
        displayName: 'ChatGPT 账号',
      },
    ],
    apiConnectionDefaults: {
      displayName: 'Responses-compatible API',
      baseUrl: 'https://api.openai.com/v1',
    },
    inspectAccountConnection,
    startLogin: vi.fn(async (connection) => ({
      type: 'external-browser' as const,
      providerId: 'codex',
      connectionId: connection.id,
      loginId: 'login-1',
      url: 'https://chatgpt.com/login',
    })),
    cancelLogin: vi.fn(async () => undefined),
    normalizeApiConnectionBaseUrl: normalizeCodexResponsesBaseUrl,
    getModelCatalog: vi.fn(async (configuration) => ({
      providerId: 'codex',
      connectionId: configuration.id,
      allowsCustomModel: configuration.kind === 'api-key',
      models:
        configuration.kind === 'api-key'
          ? []
          : [
              {
                id: 'gpt-test',
                displayName: 'GPT Test',
                description: '',
                isDefault: true,
                reasoningEfforts: [
                  { id: 'medium', displayName: 'Medium' },
                ],
                defaultReasoningEffort: 'medium',
              },
            ],
    })),
    createRunner: vi.fn(({ configuration }) => ({
      providerId: 'codex',
      connectionId: configuration.id,
      async *runTurn() {
        yield* [] as never[];
        throw new Error('not used');
      },
    })),
  };
}

function createService(input: {
  readonly provider?: AgentProvider;
  readonly probeUrl?: (url: string) => Promise<void>;
} = {}) {
  const { settings, connections, selections } = createSettings();
  const { store: secrets, values: secretValues } = createSecrets();
  const provider = input.provider ?? createProvider();
  const providers = new AgentProviderRegistry();
  providers.register(provider);
  const selectors = new AgentProviderSelectorRegistry();
  selectors.register({
    id: GENERATION_CENTER_AGENT_PROVIDER_SELECTOR_ID,
    displayName: '生成中心',
    description: '生成 Project 内容。',
  });
  let nextConnectionNumber = 1;
  const service = new AgentProviderService(
    settings,
    secrets,
    providers,
    selectors,
    {
      createId: () => `connection-${nextConnectionNumber++}`,
      probeUrl: input.probeUrl ?? (async () => undefined),
    },
  );
  return {
    service,
    settings,
    connections,
    selections,
    secrets,
    secretValues,
    provider,
  };
}

describe('AgentProviderService', () => {
  it('publishes Provider connections and Main-registered selectors', async () => {
    const { service, provider } = createService();

    await service.getSetup();
    await vi.waitFor(() =>
      expect(provider.inspectAccountConnection).toHaveBeenCalled(),
    );
    const setup = await service.getSetup();

    expect(setup.selectors).toEqual([
      {
        id: 'generation-center',
        displayName: '生成中心',
        description: '生成 Project 内容。',
      },
    ]);
    expect(setup.providers[0]?.connections[0]).toMatchObject({
      id: 'codex-account',
      kind: 'account',
      status: 'ready',
      hasApiKey: false,
      removable: false,
    });

    await service.dispose();
  });

  it('creates multiple API connections while keeping keys outside settings', async () => {
    const { service, connections, secretValues } = createService();

    const firstSetup = await service.configureApiConnection({
      providerId: 'codex',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'secret-one',
    });
    await service.configureApiConnection({
      providerId: 'codex',
      displayName: 'Doubao',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret-two',
    });

    expect(connections.get('codex-api-connection-1')).toEqual({
      id: 'codex-api-connection-1',
      providerId: 'codex',
      kind: 'api-key',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    expect(JSON.stringify(firstSetup)).not.toContain('secret-one');
    expect(JSON.stringify([...connections.values()])).not.toContain('secret-one');
    expect(secretValues.get('codex/codex-api-connection-1')).toBe('secret-one');
    expect(connections.get('codex-api-connection-2')).toMatchObject({
      displayName: 'Doubao',
      baseUrl: 'https://example.com/v1',
    });
    expect(secretValues.get('codex/codex-api-connection-2')).toBe('secret-two');

    await service.dispose();
  });

  it('marks API connections ready from URL reachability without validating the key', async () => {
    const probeUrl = vi.fn(async () => undefined);
    const { service } = createService({ probeUrl });

    const setup = await service.configureApiConnection({
      providerId: 'codex',
      displayName: 'Custom',
      baseUrl: 'https://example.com/v1',
      apiKey: 'not-proactively-validated',
    });

    expect(probeUrl).toHaveBeenCalledWith('https://example.com/v1');
    expect(setup.providers[0]?.connections[1]).toMatchObject({
      status: 'ready',
      hasApiKey: true,
    });

    await service.dispose();
  });

  it('accepts a full Responses endpoint and stores the Codex API root', async () => {
    const probeUrl = vi.fn(async () => undefined);
    const { service, connections } = createService({ probeUrl });

    await service.configureApiConnection({
      providerId: 'codex',
      displayName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1/responses',
      apiKey: 'secret',
    });

    expect(connections.get('codex-api-connection-1')).toMatchObject({
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(probeUrl).toHaveBeenCalledWith('https://api.openai.com/v1');

    await service.dispose();
  });

  it('keeps a configured API connection but marks it unavailable when URL probing fails', async () => {
    const { service } = createService({
      probeUrl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    const setup = await service.configureApiConnection({
      providerId: 'codex',
      displayName: 'Offline',
      baseUrl: 'https://offline.example/v1',
      apiKey: 'secret',
    });

    expect(setup.providers[0]?.connections[1]).toMatchObject({
      status: 'unavailable',
      hasApiKey: true,
    });

    await service.dispose();
  });

  it('persists Selector configuration without resolving Connection readiness', async () => {
    const inspectAccountConnection = vi.fn(async () => ({
      status: 'unconfigured' as const,
    }));
    const provider = createProvider(inspectAccountConnection);
    const { service, settings } = createService({ provider });

    await service.selectForSelector({
      selectorId: 'generation-center',
      providerId: 'codex',
      connectionId: 'codex-account',
      modelId: 'gpt-test',
      reasoningEffort: 'medium',
    });

    expect(inspectAccountConnection).not.toHaveBeenCalled();

    expect(settings.updateAgentProviderSelectorSelection).toHaveBeenCalledWith({
      selectorId: 'generation-center',
      providerId: 'codex',
      connectionId: 'codex-account',
      modelId: 'gpt-test',
      reasoningEffort: 'medium',
    });
    expect(service.resolveSelectorConfiguration('generation-center')).toEqual({
      providerId: 'codex',
      connectionId: 'codex-account',
      modelId: 'gpt-test',
      reasoningEffort: 'medium',
    });
    await expect(
      service.resolveRunner({
        providerId: 'codex',
        connectionId: 'codex-account',
        modelId: 'gpt-test',
        reasoningEffort: 'medium',
      }),
    ).rejects.toThrow('AGENT_PROVIDER_AUTH_REQUIRED');
    expect(inspectAccountConnection).toHaveBeenCalledOnce();

    await service.dispose();
  });

  it('allows a manual model id for an API Connection', async () => {
    const { service } = createService();
    await service.configureApiConnection({
      providerId: 'codex',
      displayName: 'Custom',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
    });

    const setup = await service.selectForSelector({
      selectorId: 'generation-center',
      providerId: 'codex',
      connectionId: 'codex-api-connection-1',
      modelId: 'deepseek-chat',
      reasoningEffort: null,
    });

    expect(setup.selections[0]).toMatchObject({
      connectionId: 'codex-api-connection-1',
      modelId: 'deepseek-chat',
    });
    expect(setup.selectorConnections).toEqual([
      {
        selectorId: 'generation-center',
        providerId: 'codex',
        connectionId: 'codex-api-connection-1',
      },
    ]);

    await service.dispose();
  });

  it('publishes the active Connection separately from per-Connection model configurations', async () => {
    const { service } = createService();
    await service.configureApiConnection({
      providerId: 'codex',
      displayName: 'Custom',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
    });
    await service.selectForSelector({
      selectorId: 'generation-center',
      providerId: 'codex',
      connectionId: 'codex-account',
      modelId: 'gpt-test',
      reasoningEffort: 'medium',
    });

    const setup = await service.selectForSelector({
      selectorId: 'generation-center',
      providerId: 'codex',
      connectionId: 'codex-api-connection-1',
      modelId: 'deepseek-chat',
      reasoningEffort: null,
    });

    expect(setup.selections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectionId: 'codex-account',
          modelId: 'gpt-test',
        }),
        expect.objectContaining({
          connectionId: 'codex-api-connection-1',
          modelId: 'deepseek-chat',
        }),
      ]),
    );
    expect(setup.selectorConnections).toEqual([
      {
        selectorId: 'generation-center',
        providerId: 'codex',
        connectionId: 'codex-api-connection-1',
      },
    ]);
    expect(service.resolveSelectorConfiguration('generation-center')).toEqual({
      providerId: 'codex',
      connectionId: 'codex-api-connection-1',
      modelId: 'deepseek-chat',
    });

    await service.dispose();
  });

  it('resolves a runner bound to the selected Connection', async () => {
    const { service, provider } = createService();
    await service.getModelCatalog('codex', 'codex-account');

    const runner = await service.resolveRunner({
      providerId: 'codex',
      connectionId: 'codex-account',
      modelId: 'gpt-test',
    });

    expect(runner).toMatchObject({
      providerId: 'codex',
      connectionId: 'codex-account',
    });
    expect(provider.createRunner).toHaveBeenCalledWith({
      configuration: expect.objectContaining({ id: 'codex-account' }),
    });

    await service.dispose();
  });

  it('starts account login for the explicit Connection', async () => {
    const { service, provider } = createService();

    await expect(
      service.startLogin('codex', 'codex-account'),
    ).resolves.toMatchObject({
      providerId: 'codex',
      connectionId: 'codex-account',
      loginId: 'login-1',
    });
    expect(provider.startLogin).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'codex-account' }),
    );

    await service.dispose();
  });

  it('deletes removable Connections together with their Selector and encrypted secret', async () => {
    const { service, secretValues, selections } = createService();
    await service.configureApiConnection({
      providerId: 'codex',
      displayName: 'Custom',
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
    });
    await service.selectForSelector({
      selectorId: 'generation-center',
      providerId: 'codex',
      connectionId: 'codex-api-connection-1',
      modelId: 'custom-model',
      reasoningEffort: null,
    });
    expect(selections.size).toBe(1);

    const setup = await service.deleteConnection(
      'codex',
      'codex-api-connection-1',
    );

    expect(setup.providers[0]?.connections).toHaveLength(1);
    expect(setup.selections).toEqual([]);
    expect(selections.size).toBe(0);
    expect(secretValues.size).toBe(0);
    await expect(
      service.deleteConnection('codex', 'codex-account'),
    ).rejects.toThrow();

    await service.dispose();
  });
});
