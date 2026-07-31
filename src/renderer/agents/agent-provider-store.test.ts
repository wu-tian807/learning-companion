import { describe, expect, it, vi } from 'vitest';

import type { AgentProviderSetupSnapshot } from '../../shared/agent-providers';
import {
  createAgentProviderStore,
  type AgentProviderRendererApi,
} from './agent-provider-store';

function setupSnapshot(
  revision: number,
  status:
    | 'checking'
    | 'authenticated'
    | 'unauthenticated'
    | 'unavailable' = 'unauthenticated',
): AgentProviderSetupSnapshot {
  const authenticated = status === 'authenticated';

  return {
    revision,
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
        refreshing: status === 'checking',
        credential:
          status === 'unavailable'
            ? { status, message: '暂时无法检查登录状态' }
            : authenticated
              ? { status, account: { email: 'student@example.com' } }
              : { status },
      },
    ],
  };
}

interface ApiHarness {
  readonly api: AgentProviderRendererApi;
  emit(snapshot: AgentProviderSetupSnapshot): void;
  resolveInitial(snapshot: AgentProviderSetupSnapshot): void;
  readonly disposeSubscription: ReturnType<typeof vi.fn>;
  readonly callOrder: string[];
}

function createApiHarness(): ApiHarness {
  let listener:
    | ((snapshot: AgentProviderSetupSnapshot) => void)
    | undefined;
  let resolveInitial:
    | ((snapshot: AgentProviderSetupSnapshot) => void)
    | undefined;
  const callOrder: string[] = [];
  const disposeSubscription = vi.fn();
  const api: AgentProviderRendererApi = {
    getAgentProviderSetup: vi.fn(() => {
      callOrder.push('get');
      return new Promise<AgentProviderSetupSnapshot>((resolve) => {
        resolveInitial = resolve;
      });
    }),
    refreshAgentProvider: vi.fn(async () => setupSnapshot(3)),
    onAgentProviderSetupChanged: vi.fn((nextListener) => {
      callOrder.push('subscribe');
      listener = nextListener;
      return disposeSubscription;
    }),
  };

  return {
    api,
    emit(snapshot) {
      listener?.(snapshot);
    },
    resolveInitial(snapshot) {
      resolveInitial?.(snapshot);
    },
    disposeSubscription,
    callOrder,
  };
}

describe('Agent Provider Renderer Store', () => {
  it('先订阅事件再读取初始快照', () => {
    const harness = createApiHarness();
    const store = createAgentProviderStore(harness.api);

    store.getState().connect();

    expect(harness.callOrder).toEqual(['subscribe', 'get']);
  });

  it('不会让较旧的初始响应覆盖较新的事件', async () => {
    const harness = createApiHarness();
    const store = createAgentProviderStore(harness.api);

    store.getState().connect();
    harness.emit(setupSnapshot(2, 'authenticated'));
    harness.resolveInitial(setupSnapshot(1));
    await vi.waitFor(() => {
      expect(store.getState().loading).toBe(false);
    });

    expect(store.getState().setup?.revision).toBe(2);
    expect(
      store.getState().setup?.providers[0]?.credential.status,
    ).toBe('authenticated');
  });

  it('忽略相同或更低 revision 的状态', () => {
    const store = createAgentProviderStore(
      createApiHarness().api,
      {
        setup: setupSnapshot(4, 'authenticated'),
      },
    );

    store.getState().applySnapshot(setupSnapshot(4));
    store.getState().applySnapshot(setupSnapshot(3));

    expect(
      store.getState().setup?.providers[0]?.credential.status,
    ).toBe('authenticated');
  });

  it('复用订阅并在最后一个消费者离开时释放', () => {
    const harness = createApiHarness();
    const store = createAgentProviderStore(harness.api);

    const disconnectFirst = store.getState().connect();
    const disconnectSecond = store.getState().connect();

    expect(
      harness.api.onAgentProviderSetupChanged,
    ).toHaveBeenCalledTimes(1);
    disconnectFirst();
    expect(harness.disposeSubscription).not.toHaveBeenCalled();
    disconnectSecond();
    expect(harness.disposeSubscription).toHaveBeenCalledTimes(1);
  });

  it('只请求刷新指定的 Provider 并接收响应快照', async () => {
    const harness = createApiHarness();
    const store = createAgentProviderStore(harness.api, {
      setup: setupSnapshot(1),
    });

    const snapshot = await store
      .getState()
      .refreshProvider('codex');

    expect(harness.api.refreshAgentProvider).toHaveBeenCalledWith({
      providerId: 'codex',
    });
    expect(snapshot.revision).toBe(3);
    expect(store.getState().setup?.revision).toBe(3);
  });

  it('重新连接时保留快照并再次向 Main 请求状态', () => {
    const harness = createApiHarness();
    const store = createAgentProviderStore(harness.api, {
      setup: setupSnapshot(1),
    });

    const disconnect = store.getState().connect();
    disconnect();
    store.getState().connect();

    expect(store.getState().setup?.revision).toBe(1);
    expect(harness.api.getAgentProviderSetup).toHaveBeenCalledTimes(2);
  });
});
