import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AgentProviderSetupSnapshot } from '../../shared/agent-providers';
import { AgentProviderSelector } from './AgentProviderSelector';
import type { AgentProviderSetupApi } from './agent-provider-api';
import { createAgentProviderStore } from './agent-provider-store';

const setup: AgentProviderSetupSnapshot = Object.freeze({
  revision: 1,
  selectors: Object.freeze([
    Object.freeze({
      id: 'generation-center',
      displayName: '生成中心',
      description: '生成 Project 内容。',
    }),
  ]),
  selections: Object.freeze([]),
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
    expect(markup).toContain('>high<');
    expect(markup).not.toContain('没有可配置的 Connection');
    expect(markup).not.toContain('<select');
  });
});
