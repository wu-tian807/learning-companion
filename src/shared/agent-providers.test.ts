import { describe, expect, it } from 'vitest';

import {
  isAgentProviderId,
  isAgentProviderLoginChallenge,
  isAgentProviderSetupSnapshot,
} from './agent-providers';

const provider = {
  id: 'codex',
  displayName: 'Codex',
  description: 'OpenAI Codex',
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
      status: 'ready',
      account: { email: 'student@example.com' },
      hasApiKey: false,
      refreshing: false,
      removable: false,
    },
  ],
} as const;

const selector = {
  id: 'generation-center',
  displayName: '生成中心',
  description: '生成 Project 内容。',
} as const;

describe('Agent Provider contracts', () => {
  it('accepts stable Provider ids', () => {
    expect(isAgentProviderId('codex')).toBe(true);
    expect(isAgentProviderId('open-code_2')).toBe(true);
    expect(isAgentProviderId('../codex')).toBe(false);
  });

  it('validates Providers, Connections, Selectors and composite selections', () => {
    expect(
      isAgentProviderSetupSnapshot({
        revision: 3,
        providers: [provider],
        selectors: [selector],
        selections: [
          {
            selectorId: 'generation-center',
            providerId: 'codex',
            connectionId: 'codex-account',
            modelId: 'gpt-5.4',
            reasoningEffort: 'high',
          },
        ],
        selectorConnections: [
          {
            selectorId: 'generation-center',
            providerId: 'codex',
            connectionId: 'codex-account',
          },
        ],
      }),
    ).toBe(true);
  });

  it('rejects selections that reference another Provider or Connection', () => {
    expect(
      isAgentProviderSetupSnapshot({
        revision: 4,
        providers: [provider],
        selectors: [selector],
        selections: [
          {
            selectorId: 'generation-center',
            providerId: 'codex',
            connectionId: 'missing',
            modelId: null,
            reasoningEffort: null,
          },
        ],
        selectorConnections: [],
      }),
    ).toBe(false);
  });

  it('keeps refreshing independent from the three persisted statuses', () => {
    expect(
      isAgentProviderSetupSnapshot({
        revision: 0,
        providers: [
          {
            ...provider,
            connections: [
              {
                id: 'codex-api-1',
                providerId: 'codex',
                kind: 'api-key',
                displayName: 'Custom',
                baseUrl: 'https://example.com/v1',
                status: 'unavailable',
                statusMessage: '无法连接 Base URL。',
                hasApiKey: true,
                refreshing: true,
                removable: true,
              },
            ],
          },
        ],
        selectors: [selector],
        selections: [],
        selectorConnections: [],
      }),
    ).toBe(true);
  });

  it('rejects an active Selector Connection without a matching configuration', () => {
    expect(
      isAgentProviderSetupSnapshot({
        revision: 5,
        providers: [provider],
        selectors: [selector],
        selections: [],
        selectorConnections: [
          {
            selectorId: 'generation-center',
            providerId: 'codex',
            connectionId: 'codex-account',
          },
        ],
      }),
    ).toBe(false);
  });

  it('validates connection-scoped login instructions', () => {
    expect(
      isAgentProviderLoginChallenge({
        type: 'external-browser',
        providerId: 'codex',
        connectionId: 'codex-account',
        loginId: 'login-1',
        url: 'https://chatgpt.com/login',
      }),
    ).toBe(true);
    expect(
      isAgentProviderLoginChallenge({
        type: 'device-code',
        providerId: 'codex',
        connectionId: 'codex-account',
        loginId: 'login-2',
        verificationUrl: 'https://auth.openai.com/device',
        userCode: 'ABCD-1234',
      }),
    ).toBe(true);
  });
});
