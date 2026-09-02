import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AgentProviderSetupSnapshot } from '../../shared/agent-providers';
import { AgentProviderSelector } from './AgentProviderSelector';
import type { AgentProviderSetupApi } from './agent-provider-api';
import { createAgentProviderStore } from './agent-provider-store';

const setup: AgentProviderSetupSnapshot = {
  revision: 1,
  selectors: [
    {
      id: 'generation-center',
      displayName: '生成中心',
      description: '生成 Project 内容。',
    },
  ],
  selections: [
    {
      selectorId: 'generation-center',
      providerId: 'codex',
      connectionId: 'codex-account',
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
    },
  ],
  providers: [
    {
      id: 'codex',
      displayName: 'Codex',
      description: '使用 Codex Agent 执行生成任务。',
      supportedConnectionKinds: ['account'],
      connections: [
        {
          id: 'codex-account',
          providerId: 'codex',
          kind: 'account',
          displayName: 'ChatGPT 账号',
          status: 'unconfigured',
          hasApiKey: false,
          refreshing: true,
          removable: false,
        },
      ],
    },
  ],
};

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
  it('renders the Main-resolved selection before Connection readiness resolves', () => {
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
  });

  it('renders the one effective Connection returned by Main', () => {
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
          connectionId: 'codex-api-1',
          modelId: 'deepseek-chat',
          reasoningEffort: 'medium',
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
    expect(markup).toContain('>medium<');
  });
});
