import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AgentProviderSetupSnapshot } from '../../shared/agent-providers';
import { AgentProviderSetupDialog } from './AgentProviderSetupDialog';
import { createAgentProviderStore } from './agent-provider-store';

function setup(
  status: 'authenticated' | 'unauthenticated' | 'unavailable',
): AgentProviderSetupSnapshot {
  return {
    revision: 0,
    selectedProviderId: null,
    activeProviderId: null,
    requiresSelection: true,
    providers: [
      {
        id: 'codex',
        displayName: 'Codex',
        description: '使用 ChatGPT 账号额度运行内置 Codex Agent。',
        loginLabel: '使用 ChatGPT 登录',
        selected: false,
        refreshing: false,
        credential:
          status === 'authenticated'
            ? {
                status,
                account: {
                  email: 'student@example.com',
                  planType: 'plus',
                },
              }
            : status === 'unavailable'
              ? {
                  status,
                  message: '暂时无法检查登录状态',
                }
              : { status },
      },
    ],
  };
}

const api = {
  getAgentProviderSetup: vi.fn(),
  refreshAgentProvider: vi.fn(),
  onAgentProviderSetupChanged: vi.fn(() => () => undefined),
  startAgentProviderLogin: vi.fn(),
  cancelAgentProviderLogin: vi.fn(),
  selectAgentProvider: vi.fn(),
  completeAgentProviderOnboarding: vi.fn(),
  openExternal: vi.fn(),
};

describe('AgentProviderSetupDialog', () => {
  it('requires login before an unauthenticated Provider can be selected', () => {
    const markup = renderToStaticMarkup(
      <AgentProviderSetupDialog
        onCompleted={vi.fn()}
        api={api}
        store={createAgentProviderStore(api, {
          setup: setup('unauthenticated'),
        })}
      />,
    );

    expect(markup).toContain('选择 AI Provider');
    expect(markup).toContain('之后可在右上角“设置”中更改');
    expect(markup).toContain('使用 ChatGPT 登录');
    expect(markup).not.toContain('选择 Codex');
    expect(markup).not.toContain('登录 Token');
    expect(markup).not.toContain('登录凭证由 Provider');
  });

  it('offers selection only after credential verification succeeds', () => {
    const markup = renderToStaticMarkup(
      <AgentProviderSetupDialog
        onCompleted={vi.fn()}
        api={api}
        store={createAgentProviderStore(api, {
          setup: setup('authenticated'),
        })}
      />,
    );

    expect(markup).toContain('student@example.com');
    expect(markup).toContain('plus 计划');
    expect(markup).toContain('选择 Codex');
  });

  it('keeps an unavailable Provider retryable', () => {
    const markup = renderToStaticMarkup(
      <AgentProviderSetupDialog
        onCompleted={vi.fn()}
        api={api}
        store={createAgentProviderStore(api, {
          setup: setup('unavailable'),
        })}
      />,
    );

    expect(markup).toContain('状态不可用');
    expect(markup).toContain('重新检查');
    expect(markup).not.toContain('选择 Codex');
  });
});
