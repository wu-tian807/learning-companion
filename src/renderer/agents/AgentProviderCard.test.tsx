import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AgentProviderSnapshot } from '../../shared/agent-providers';
import { AgentProviderCard } from './AgentProviderCard';

const provider: AgentProviderSnapshot = {
  id: 'codex',
  displayName: 'Codex',
  description: '使用 Codex Agent 执行生成任务。',
  supportedConnectionKinds: ['account', 'api-key'],
  connections: [
    {
      id: 'codex-account',
      providerId: 'codex',
      kind: 'account',
      displayName: 'ChatGPT 账号',
      status: 'ready',
      account: { email: 'student@example.com', planType: 'plus' },
      hasApiKey: false,
      refreshing: false,
      removable: false,
    },
    {
      id: 'codex-api-1',
      providerId: 'codex',
      kind: 'api-key',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      status: 'unavailable',
      statusMessage: '暂时无法访问 Base URL',
      hasApiKey: true,
      refreshing: false,
      removable: true,
    },
  ],
  apiConnectionDefaults: {
    displayName: 'Responses-compatible API',
    baseUrl: 'https://api.openai.com/v1',
  },
};

describe('AgentProviderCard', () => {
  it('只概括 Provider 及其可用连接数量', () => {
    const markup = renderToStaticMarkup(
      <AgentProviderCard provider={provider}>
        <span>连接面板</span>
      </AgentProviderCard>,
    );

    expect(markup).toContain('Codex');
    expect(markup).toContain('1 个连接可用');
    expect(markup).toContain('连接面板');
    expect(markup).not.toContain('继续使用');
    expect(markup).not.toContain('已选择');
  });

  it('没有 ready Connection 时明确显示尚不可用', () => {
    const markup = renderToStaticMarkup(
      <AgentProviderCard
        provider={{
          ...provider,
          connections: provider.connections.map((connection) => ({
            ...connection,
            status: 'unconfigured' as const,
          })),
        }}
      >
        <span />
      </AgentProviderCard>,
    );

    expect(markup).toContain('尚无可用连接');
  });
});
