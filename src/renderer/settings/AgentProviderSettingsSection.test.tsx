import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AgentProviderSetupSnapshot } from '../../shared/agent-providers';
import type { AgentProviderSetupApi } from '../agents/agent-provider-api';
import { createAgentProviderStore } from '../agents/agent-provider-store';
import { AgentProviderSettingsSection } from './AgentProviderSettingsSection';

const setup: AgentProviderSetupSnapshot = {
  revision: 1,
  defaultSelectorId: 'intelligence-medium',
  providers: [],
  selectors: [
    {
      id: 'intelligence-high',
      displayName: '高智能',
      description: '复杂任务。',
    },
    {
      id: 'intelligence-medium',
      displayName: '中智能',
      description: '常规任务。',
    },
  ],
  selections: [],
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
    selectDefaultAgentProviderSelector: vi.fn(),
    completeAgentProviderOnboarding: vi.fn(),
    openExternal: vi.fn(),
  };
}

describe('AgentProviderSettingsSection', () => {
  it('shows the persisted global default strength before individual profiles', () => {
    const api = createApi();
    const markup = renderToStaticMarkup(
      <AgentProviderSettingsSection
        api={api}
        store={createAgentProviderStore(api, { setup })}
      />,
    );

    expect(markup).toContain('全局默认智能强度');
    expect(markup).toContain('所有新建的 AI 任务都会使用此强度对应的模型');
    expect(markup).toContain('中智能');
  });
});
