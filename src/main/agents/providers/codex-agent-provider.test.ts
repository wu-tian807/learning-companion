import { describe, expect, it, vi } from 'vitest';

import type { CodexRuntimeServiceApi } from '../codex/codex-runtime-service-api';
import { CodexAgentProvider } from './codex-agent-provider';

function createRuntime(
  overrides: Partial<CodexRuntimeServiceApi> = {},
): CodexRuntimeServiceApi {
  return {
    subscribe: vi.fn(() => () => undefined),
    getAccount: vi.fn(async () => ({
      account: null,
      requiresOpenaiAuth: true,
    })),
    startChatGptLogin: vi.fn(),
    cancelLogin: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as CodexRuntimeServiceApi;
}

describe('CodexAgentProvider', () => {
  it('maps account/read into a Provider credential snapshot', async () => {
    const provider = new CodexAgentProvider(
      createRuntime({
        getAccount: vi.fn(async () => ({
          account: {
            type: 'chatgpt',
            email: 'student@example.com',
            planType: 'plus',
          },
          requiresOpenaiAuth: true,
        })),
      }),
    );

    await expect(provider.getCredentialState(true)).resolves.toEqual({
      status: 'authenticated',
      account: {
        email: 'student@example.com',
        planType: 'plus',
        authenticationMethod: 'chatgpt',
      },
    });
  });

  it('treats a missing account as unauthenticated', async () => {
    const provider = new CodexAgentProvider(createRuntime());

    await expect(provider.getCredentialState()).resolves.toEqual({
      status: 'unauthenticated',
    });
  });

  it('uses the App Server managed browser login flow', async () => {
    const startChatGptLogin = vi.fn(async () => ({
      type: 'chatgpt' as const,
      loginId: 'login-1',
      authUrl: 'https://chatgpt.com/login',
    }));
    const provider = new CodexAgentProvider(
      createRuntime({ startChatGptLogin }),
    );

    await expect(provider.startLogin()).resolves.toEqual({
      type: 'external-browser',
      providerId: 'codex',
      loginId: 'login-1',
      url: 'https://chatgpt.com/login',
    });
    expect(startChatGptLogin).toHaveBeenCalledWith('browser');
  });

  it('invalidates credentials only for account and runtime availability events', () => {
    let listener:
      | Parameters<CodexRuntimeServiceApi['subscribe']>[0]
      | undefined;
    const runtime = createRuntime({
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        return () => undefined;
      }),
    });
    const invalidated = vi.fn();
    const provider = new CodexAgentProvider(runtime);

    provider.subscribeCredentialInvalidation(invalidated);
    listener?.({
      type: 'notification',
      notification: {
        method: 'thread/started',
        params: {},
      },
    });
    listener?.({
      type: 'notification',
      notification: {
        method: 'account/login/completed',
        params: {},
      },
    });
    listener?.({
      type: 'state-changed',
      snapshot: {
        phase: 'failed',
        failure: { message: 'closed' },
      },
    });

    expect(invalidated).toHaveBeenCalledTimes(2);
  });
});
