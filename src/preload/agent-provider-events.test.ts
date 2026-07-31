import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../shared/ipc';
import { subscribeAgentProviderEvents } from './agent-provider-events';

describe('Preload AgentProvider Event subscription', () => {
  it('validates snapshots and removes only its own listener', () => {
    let wrappedListener:
      | ((event: unknown, value: unknown) => void)
      | undefined;
    const ipc = {
      on: vi.fn((_channel, listener) => {
        wrappedListener = listener;
        return ipc;
      }),
      removeListener: vi.fn(() => ipc),
    };
    const listener = vi.fn();
    const dispose = subscribeAgentProviderEvents(ipc, listener);
    const snapshot = {
      revision: 2,
      selectedProviderId: null,
      activeProviderId: null,
      requiresSelection: true,
      providers: [
        {
          id: 'codex',
          displayName: 'Codex',
          description: '使用 ChatGPT 账号运行 Codex。',
          loginLabel: '使用 ChatGPT 登录',
          selected: false,
          credential: { status: 'checking' },
          refreshing: true,
        },
      ],
    };

    wrappedListener?.({}, snapshot);
    wrappedListener?.({}, { ...snapshot, revision: -1 });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(snapshot);

    dispose();
    expect(ipc.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.agentProviderChanged,
      wrappedListener,
    );
  });
});
