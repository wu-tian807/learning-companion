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
      selectors: [],
      selections: [],
      selectorConnections: [],
      providers: [
        {
          id: 'codex',
          displayName: 'Codex',
          description: '使用 ChatGPT 账号运行 Codex。',
          supportedConnectionKinds: ['account', 'api-key'],
          connections: [
            {
              id: 'codex-account',
              providerId: 'codex',
              kind: 'account',
              displayName: 'ChatGPT 账号',
              status: 'unconfigured',
              hasApiKey: false,
              refreshing: true,
              removable: false,
            },
          ],
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
