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
            credential: { status: 'unauthenticated' },
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
