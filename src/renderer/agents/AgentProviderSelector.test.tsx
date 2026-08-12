import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AgentProviderSetupSnapshot } from '../../shared/agent-providers';
import { AgentProviderSelector } from './AgentProviderSelector';
import type { AgentProviderSetupApi } from './agent-provider-api';
import { createAgentProviderStore } from './agent-provider-store';
import {
  findActiveSelectorConnectionSelection,
  findSelectorConnectionSelection,
} from './selector-connection-selection';

const setup: AgentProviderSetupSnapshot = Object.freeze({
  revision: 1,
  selectors: Object.freeze([
    Object.freeze({
      id: 'generation-center',
      displayName: '生成中心',
      description: '生成 Project 内容。',
      defaultSelection: {
        providerId: 'codex',
        connectionId: 'codex-account',
        modelId: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
      },
    }),
  ]),
  selections: Object.freeze([]),
  selectorConnections: Object.freeze([]),
  providers: Object.freeze([
    Object.freeze({
      id: 'codex',
      displayName: 'Codex',
      description: '使用 Codex Agent 执行生成任务。',
      supportedConnectionKinds: Object.freeze(['account' as const]),
      connections: Object.freeze([
        Object.freeze({
          id: 'codex-account',
          providerId: 'codex',
          kind: 'account',
          displayName: 'ChatGPT 账号',
          status: 'unconfigured',
          hasApiKey: false,
          refreshing: true,
          removable: false,
        }),
      ]),
    }),
  ]),
});

function createApi(): AgentProviderSetupApi {
  return {
    getAgentProviderSetup: vi.fn(),
    refreshAgentProvider: vi.fn(),
    onAgentProviderSetupChanged: vi.fn(() => () => undefined),
    startAgentProviderLogin: vi.fn(),
    cancelAgentProviderLogin: vi.fn(),
    configureAgentProviderApiConnection: vi.fn(),
    deleteAgentProviderConnection: vi.fn(),
    getAgentProviderModels: vi.fn(),
    selectAgentProviderForSelector: vi.fn(),
    completeAgentProviderOnboarding: vi.fn(),
    openExternal: vi.fn(),
  };
}

describe('AgentProviderSelector', () => {
  it('renders Selector configuration before Connection readiness resolves', () => {
    const api = createApi();
    const markup = renderToStaticMarkup(
      <AgentProviderSelector
        selectorId="generation-center"
        api={api}
        store={createAgentProviderStore(api, { setup })}
      />,
    );

    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('aria-label="生成中心 思考力度"');
    expect(markup).toContain('>medium<');
    expect(markup).not.toContain('没有可配置的 Connection');
    expect(markup).not.toContain('<select');
  });

  it('restores the explicitly active Connection when multiple configurations exist', () => {
    const api = createApi();
    const provider = setup.providers[0]!;
    const configuredSetup: AgentProviderSetupSnapshot = {
      ...setup,
      providers: [
        {
          ...provider,
          supportedConnectionKinds: ['account', 'api-key'],
          connections: [
            ...provider.connections,
            {
              id: 'codex-api-1',
              providerId: 'codex',
              kind: 'api-key',
              displayName: 'DeepSeek API',
              baseUrl: 'https://api.deepseek.com',
              status: 'ready',
              hasApiKey: true,
              refreshing: false,
              removable: true,
            },
          ],
        },
      ],
      selections: [
        {
          selectorId: 'generation-center',
          providerId: 'codex',
          connectionId: 'codex-account',
          modelId: 'gpt-5.1',
          reasoningEffort: 'high',
        },
        {
          selectorId: 'generation-center',
          providerId: 'codex',
          connectionId: 'codex-api-1',
          modelId: 'deepseek-chat',
          reasoningEffort: 'medium',
        },
      ],
      selectorConnections: [
        {
          selectorId: 'generation-center',
          providerId: 'codex',
          connectionId: 'codex-api-1',
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <AgentProviderSelector
        selectorId="generation-center"
        api={api}
        store={createAgentProviderStore(api, { setup: configuredSetup })}
      />,
    );

    expect(markup).toContain('Codex · DeepSeek API');
  });
});

describe('findSelectorConnectionSelection', () => {
  it('finds the saved model configuration for a specific Connection', () => {
    const selection = findSelectorConnectionSelection(
      {
        ...setup,
        selections: Object.freeze([
          Object.freeze({
            selectorId: 'generation-center',
            providerId: 'codex',
            connectionId: 'codex-account',
            modelId: 'gpt-5.1',
            reasoningEffort: 'high',
          }),
        ]),
      },
      'generation-center',
      'codex-account',
    );

    expect(selection).toEqual({
      selectorId: 'generation-center',
      providerId: 'codex',
      connectionId: 'codex-account',
      modelId: 'gpt-5.1',
      reasoningEffort: 'high',
    });
  });

  it('uses the explicitly active Connection instead of the first saved configuration', () => {
    const active = findActiveSelectorConnectionSelection(
      {
        ...setup,
        selections: Object.freeze([
          Object.freeze({
            selectorId: 'generation-center',
            providerId: 'codex',
            connectionId: 'codex-account',
            modelId: 'gpt-5.1',
            reasoningEffort: 'high',
          }),
          Object.freeze({
            selectorId: 'generation-center',
            providerId: 'codex',
            connectionId: 'codex-api-1',
            modelId: 'deepseek-chat',
            reasoningEffort: 'medium',
          }),
        ]),
        selectorConnections: Object.freeze([
          Object.freeze({
            selectorId: 'generation-center',
            providerId: 'codex',
            connectionId: 'codex-api-1',
          }),
        ]),
      },
      'generation-center',
    );

    expect(active?.connectionId).toBe('codex-api-1');
    expect(active?.modelId).toBe('deepseek-chat');
  });

  it('does not confuse configurations of different Connections for the same Selector', () => {
    const selection = findSelectorConnectionSelection(
      {
        ...setup,
        selections: Object.freeze([
          Object.freeze({
            selectorId: 'generation-center',
            providerId: 'codex',
            connectionId: 'codex-account',
            modelId: 'gpt-5.1',
            reasoningEffort: 'high',
          }),
          Object.freeze({
            selectorId: 'generation-center',
            providerId: 'codex',
            connectionId: 'codex-api-1',
            modelId: 'deepseek-chat',
            reasoningEffort: 'medium',
          }),
        ]),
      },
      'generation-center',
      'codex-api-1',
    );

    expect(selection?.modelId).toBe('deepseek-chat');
  });

  it('returns undefined when the Connection has no saved configuration', () => {
    const selection = findSelectorConnectionSelection(
      setup,
      'generation-center',
      'codex-account',
    );

    expect(selection).toBeUndefined();
  });
});
