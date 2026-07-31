import { describe, expect, it } from 'vitest';

import {
  isAgentProviderId,
  isAgentProviderLoginChallenge,
  isAgentProviderSetupSnapshot,
} from './agent-providers';

describe('Agent Provider contracts', () => {
  it('accepts stable Provider ids', () => {
    expect(isAgentProviderId('codex')).toBe(true);
    expect(isAgentProviderId('open-code_2')).toBe(true);
    expect(isAgentProviderId('../codex')).toBe(false);
  });

  it('validates a setup snapshot with an authenticated active Provider', () => {
    expect(
      isAgentProviderSetupSnapshot({
        revision: 3,
        selectedProviderId: 'codex',
        activeProviderId: 'codex',
        requiresSelection: false,
        providers: [
          {
            id: 'codex',
            displayName: 'Codex',
            description: 'OpenAI Codex',
            loginLabel: '使用 ChatGPT 登录',
            selected: true,
            refreshing: false,
            credential: {
              status: 'authenticated',
              account: {
                email: 'student@example.com',
                planType: 'plus',
                authenticationMethod: 'chatgpt',
              },
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it('rejects snapshots that call an unauthenticated Provider active', () => {
    expect(
      isAgentProviderSetupSnapshot({
        revision: 4,
        selectedProviderId: 'codex',
        activeProviderId: 'codex',
        requiresSelection: false,
        providers: [
          {
            id: 'codex',
            displayName: 'Codex',
            description: 'OpenAI Codex',
            loginLabel: '使用 ChatGPT 登录',
            selected: true,
            refreshing: false,
            credential: { status: 'unauthenticated' },
          },
        ],
      }),
    ).toBe(false);
  });

  it('validates independent checking and refreshing states', () => {
    expect(
      isAgentProviderSetupSnapshot({
        revision: 0,
        selectedProviderId: null,
        activeProviderId: null,
        requiresSelection: true,
        providers: [
          {
            id: 'codex',
            displayName: 'Codex',
            description: 'OpenAI Codex',
            loginLabel: '使用 ChatGPT 登录',
            selected: false,
            credential: { status: 'checking' },
            refreshing: true,
          },
        ],
      }),
    ).toBe(true);
  });

  it('rejects malformed revision and refresh errors', () => {
    const snapshot = {
      revision: 1,
      selectedProviderId: null,
      activeProviderId: null,
      requiresSelection: true,
      providers: [
        {
          id: 'codex',
          displayName: 'Codex',
          description: 'OpenAI Codex',
          loginLabel: '使用 ChatGPT 登录',
          selected: false,
          credential: { status: 'checking' },
          refreshing: true,
        },
      ],
    };

    expect(
      isAgentProviderSetupSnapshot({
        ...snapshot,
        revision: -1,
      }),
    ).toBe(false);
    expect(
      isAgentProviderSetupSnapshot({
        ...snapshot,
        providers: [
          {
            ...snapshot.providers[0],
            refreshError: '',
          },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentProviderSetupSnapshot({
        ...snapshot,
        providers: [
          {
            ...snapshot.providers[0],
            credential: {
              status: 'checking',
              account: {},
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('validates browser and device-code login instructions', () => {
    expect(
      isAgentProviderLoginChallenge({
        type: 'external-browser',
        providerId: 'codex',
        loginId: 'login-1',
        url: 'https://chatgpt.com/login',
      }),
    ).toBe(true);
    expect(
      isAgentProviderLoginChallenge({
        type: 'device-code',
        providerId: 'codex',
        loginId: 'login-2',
        verificationUrl: 'https://auth.openai.com/device',
        userCode: 'ABCD-1234',
      }),
    ).toBe(true);
  });
});
