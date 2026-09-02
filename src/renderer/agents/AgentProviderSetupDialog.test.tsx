import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AgentProviderSetupSnapshot } from '../../shared/agent-providers';
import { AgentProviderSetupDialog } from './AgentProviderSetupDialog';
import type { AgentProviderSetupApi } from './agent-provider-api';
import { createAgentProviderStore } from './agent-provider-store';

function setup(
  status: 'ready' | 'unconfigured' | 'unavailable',
): AgentProviderSetupSnapshot {
  return {
    revision: 0,
    defaultSelectorId: null,
    selectors: [],
    selections: [],
    providers: [
      {
        id: 'codex',
        displayName: 'Codex',
        description: '使用 Codex Agent 执行生成任务。',
        supportedConnectionKinds: ['account', 'api-key'],
        apiConnectionDefaults: {
          displayName: 'Responses-compatible API',
          baseUrl: 'https://api.openai.com/v1',
        },
        connections: [
          {
            id: 'codex-account',
            providerId: 'codex',
            kind: 'account',
            displayName: 'ChatGPT 账号',
            status,
            ...(status === 'ready'
              ? {
                  account: {
                    email: 'student@example.com',
                    planType: 'plus',
                  },
                }
              : status === 'unavailable'
                ? { statusMessage: '暂时无法检查登录状态' }
                : {}),
            hasApiKey: false,
            refreshing: false,
            removable: false,
          },
        ],
      },
    ],
  };
}

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

function renderSetup(status: 'ready' | 'unconfigured' | 'unavailable') {
  const api = createApi();
  return renderToStaticMarkup(
    <AgentProviderSetupDialog
      onCompleted={vi.fn()}
      api={api}
      store={createAgentProviderStore(api, { setup: setup(status) })}
    />,
  );
}

describe('AgentProviderSetupDialog', () => {
  it('只负责建立 Connection，不混入全局 Provider 选择', () => {
    const markup = renderSetup('unconfigured');

    expect(markup).toContain('连接 AI Provider');
    expect(markup).toContain('ChatGPT 账号');
    expect(markup).toContain('登录');
    expect(markup).toContain('添加 API Connection');
    expect(markup).not.toContain('选择 Codex');
  });

  it('显示已经可用的账号 Connection', () => {
    const markup = renderSetup('ready');

    expect(markup).toContain('student@example.com');
    expect(markup).toContain('plus 计划');
    expect(markup).toContain('1 个连接可用');
  });

  it('保留 unavailable Connection 的诊断与重试入口', () => {
    const markup = renderSetup('unavailable');

    expect(markup).toContain('暂时不可用');
    expect(markup).toContain('暂时无法检查登录状态');
    expect(markup).toContain('登录');
  });
});
