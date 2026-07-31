import {
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from 'vitest';

import type {
  AgentProviderCredentialSnapshot,
  AgentProviderSetupSnapshot,
} from '../../shared/agent-providers';
import type { SettingsRepository } from '../settings/settings-repository';
import type { AgentProviderApi } from './agent-provider';
import { AgentProviderRegistry } from './agent-provider-registry';
import {
  AgentProviderService,
  type AgentProviderServiceDependencies,
} from './agent-provider-service';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

type TestProvider = Omit<
  AgentProviderApi,
  'getCredentialState' | 'startLogin' | 'cancelLogin'
> & {
  readonly getCredentialState: MockedFunction<
    AgentProviderApi['getCredentialState']
  >;
  readonly startLogin: MockedFunction<AgentProviderApi['startLogin']>;
  readonly cancelLogin: MockedFunction<AgentProviderApi['cancelLogin']>;
  invalidate(): void;
  expectInvalidationDisposed(): void;
};

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve: (value) => resolve?.(value),
    reject: (error) => reject?.(error),
  };
}

function createSettings(selected: string | null = null) {
  let selectedProviderId = selected;
  const updateSelectedAgentProviderId = vi.fn(
    async (providerId: string) => {
      selectedProviderId = providerId;
    },
  );
  const settings = {
    getSelectedAgentProviderId: vi.fn(() => selectedProviderId),
    updateSelectedAgentProviderId,
  } as unknown as SettingsRepository;

  return { settings, updateSelectedAgentProviderId };
}

function createProvider(
  id: string,
  credential:
    | AgentProviderCredentialSnapshot
    | (() => Promise<AgentProviderCredentialSnapshot>) = {
    status: 'unauthenticated',
  },
): TestProvider {
  let invalidationListener: (() => void) | undefined;
  const disposeInvalidation = vi.fn();
  const getCredentialState: MockedFunction<
    AgentProviderApi['getCredentialState']
  > =
    typeof credential === 'function'
      ? vi.fn(credential)
      : vi.fn(async () => credential);

  return {
    id,
    displayName: id === 'codex' ? 'Codex' : 'Claude Code',
    description: `${id} Provider`,
    loginLabel: `登录 ${id}`,
    getCredentialState,
    startLogin: vi.fn(async () => ({
      type: 'external-browser' as const,
      providerId: id,
      loginId: `${id}-login`,
      url: 'https://example.com/login',
    })),
    cancelLogin: vi.fn(async () => undefined),
    subscribeCredentialInvalidation: vi.fn((listener) => {
      invalidationListener = listener;
      return disposeInvalidation;
    }),
    invalidate() {
      invalidationListener?.();
    },
    expectInvalidationDisposed() {
      expect(disposeInvalidation).toHaveBeenCalledOnce();
    },
  };
}

function createTimerHarness() {
  let nextTimerId = 1;
  const callbacks = new Map<number, () => void>();
  const setTimer = vi.fn((callback: () => void) => {
    const id = nextTimerId;
    nextTimerId += 1;
    callbacks.set(id, callback);
    return id as unknown as ReturnType<typeof setTimeout>;
  });
  const clearTimer = vi.fn(
    (timer: ReturnType<typeof setTimeout>) => {
      callbacks.delete(timer as unknown as number);
    },
  );

  return {
    setTimer,
    clearTimer,
    runNext() {
      const next = callbacks.entries().next().value as
        | [number, () => void]
        | undefined;

      if (!next) {
        throw new Error('没有可运行的登录观察 Timer');
      }

      callbacks.delete(next[0]);
      next[1]();
    },
    get size() {
      return callbacks.size;
    },
  };
}

function createService(
  providers: readonly TestProvider[],
  selectedProviderId: string | null = null,
  dependencies: Partial<AgentProviderServiceDependencies> = {},
) {
  const registry = new AgentProviderRegistry();
  for (const provider of providers) {
    registry.register(provider);
  }
  const { settings, updateSelectedAgentProviderId } =
    createSettings(selectedProviderId);
  const warn = vi.fn();

  return {
    service: new AgentProviderService(settings, registry, {
      logger: { warn },
      ...dependencies,
    }),
    updateSelectedAgentProviderId,
    warn,
  };
}

function providerFrom(
  snapshot: AgentProviderSetupSnapshot,
  providerId: string,
) {
  const provider = snapshot.providers.find(
    (candidate) => candidate.id === providerId,
  );

  if (!provider) {
    throw new Error(`Snapshot 缺少 Provider：${providerId}`);
  }

  return provider;
}

describe('AgentProviderService', () => {
  it('returns every Provider immediately and lets fast Providers finish independently', async () => {
    const codexCredential = deferred<AgentProviderCredentialSnapshot>();
    const claudeCredential = deferred<AgentProviderCredentialSnapshot>();
    const codex = createProvider('codex', () => codexCredential.promise);
    const claude = createProvider(
      'claude-code',
      () => claudeCredential.promise,
    );
    const { service } = createService([codex, claude]);
    const events: AgentProviderSetupSnapshot[] = [];
    service.subscribe((snapshot) => events.push(snapshot));

    const initial = await service.getSetup();

    expect(initial.providers.map((provider) => provider.id)).toEqual([
      'codex',
      'claude-code',
    ]);
    expect(providerFrom(initial, 'codex').credential.status).toBe(
      'checking',
    );
    expect(providerFrom(initial, 'claude-code').credential.status).toBe(
      'checking',
    );

    claudeCredential.resolve({
      status: 'authenticated',
      account: { email: 'learner@example.com' },
    });
    await vi.waitFor(() => {
      const latest = events.at(-1);
      expect(latest).toBeDefined();
      expect(
        providerFrom(latest!, 'claude-code').credential.status,
      ).toBe('authenticated');
      expect(
        providerFrom(latest!, 'codex').credential.status,
      ).toBe('checking');
    });

    codexCredential.resolve({ status: 'unauthenticated' });
    await vi.waitFor(() => {
      expect(
        providerFrom(events.at(-1)!, 'codex').credential.status,
      ).toBe('unauthenticated');
    });
  });

  it('coalesces an in-flight check and refreshes again on the next read', async () => {
    const first = deferred<AgentProviderCredentialSnapshot>();
    const codex = createProvider('codex', () => first.promise);
    const { service } = createService([codex]);
    const events: AgentProviderSetupSnapshot[] = [];
    service.subscribe((snapshot) => events.push(snapshot));

    await service.getSetup();
    await service.getSetup();
    expect(codex.getCredentialState).toHaveBeenCalledOnce();

    first.resolve({ status: 'unauthenticated' });
    await vi.waitFor(() => {
      expect(
        providerFrom(events.at(-1)!, 'codex').credential.status,
      ).toBe('unauthenticated');
    });
    await Promise.resolve();
    codex.getCredentialState.mockResolvedValueOnce({
      status: 'authenticated',
      account: {},
    });

    const cached = await service.getSetup();

    expect(providerFrom(cached, 'codex').credential.status).toBe(
      'unauthenticated',
    );
    expect(codex.getCredentialState).toHaveBeenCalledTimes(2);
  });

  it('isolates first-check failures and preserves an existing credential on refresh failure', async () => {
    const codex = createProvider('codex');
    codex.getCredentialState.mockRejectedValueOnce(
      new Error('runtime failed'),
    );
    const { service, warn } = createService([codex]);
    const events: AgentProviderSetupSnapshot[] = [];
    service.subscribe((snapshot) => events.push(snapshot));

    await service.getSetup();
    await vi.waitFor(() => {
      expect(
        providerFrom(events.at(-1)!, 'codex').credential.status,
      ).toBe('unavailable');
    });

    codex.getCredentialState.mockResolvedValueOnce({
      status: 'authenticated',
      account: { email: 'student@example.com' },
    });
    await service.getSetup();
    await vi.waitFor(() => {
      expect(
        providerFrom(events.at(-1)!, 'codex').credential.status,
      ).toBe('authenticated');
    });

    codex.getCredentialState.mockRejectedValueOnce(
      new Error('temporary network failure'),
    );
    await service.getSetup();
    await vi.waitFor(() => {
      const provider = providerFrom(events.at(-1)!, 'codex');
      expect(provider.credential.status).toBe('authenticated');
      expect(provider.refreshError).toBe(
        '最新状态检查失败，可重新检查。',
      );
    });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('waits for a fresh authenticated state before selecting a Provider', async () => {
    const credential = deferred<AgentProviderCredentialSnapshot>();
    const codex = createProvider('codex', () => credential.promise);
    const { service, updateSelectedAgentProviderId } =
      createService([codex]);

    const selection = service.selectProvider('codex');
    expect(updateSelectedAgentProviderId).not.toHaveBeenCalled();

    credential.resolve({
      status: 'authenticated',
      account: { email: 'student@example.com' },
    });
    const setup = await selection;

    expect(updateSelectedAgentProviderId).toHaveBeenCalledWith('codex');
    expect(setup.activeProviderId).toBe('codex');
  });

  it('does not let a pre-login check overwrite the newer login generation', async () => {
    const staleCredential =
      deferred<AgentProviderCredentialSnapshot>();
    const timers = createTimerHarness();
    const codex = createProvider(
      'codex',
      () => staleCredential.promise,
    );
    const { service } = createService([codex], null, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const events: AgentProviderSetupSnapshot[] = [];
    service.subscribe((snapshot) => events.push(snapshot));

    await service.getSetup();
    await service.startLogin('codex');
    staleCredential.resolve({
      status: 'authenticated',
      account: { email: 'stale@example.com' },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      providerFrom(events.at(-1)!, 'codex').credential.status,
    ).toBe('checking');
    expect(timers.size).toBe(1);
  });

  it('rejects selection when the fresh state is unauthenticated', async () => {
    const codex = createProvider('codex');
    const { service, updateSelectedAgentProviderId } =
      createService([codex]);

    await expect(service.selectProvider('codex')).rejects.toMatchObject({
      code: 'AGENT_PROVIDER_AUTH_REQUIRED',
    });
    expect(updateSelectedAgentProviderId).not.toHaveBeenCalled();
  });

  it('polls login in Main until the Provider becomes authenticated', async () => {
    const timers = createTimerHarness();
    const codex = createProvider('codex', {
      status: 'authenticated',
      account: { email: 'student@example.com' },
    });
    const { service } = createService([codex], null, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      loginPollIntervalMs: 10,
    });

    await service.startLogin('codex');
    expect(timers.size).toBe(1);
    timers.runNext();

    await vi.waitFor(() => {
      expect(codex.getCredentialState).toHaveBeenCalledOnce();
      expect(timers.size).toBe(0);
    });
  });

  it('cancels a replaced login and disposes Provider-owned resources', async () => {
    const timers = createTimerHarness();
    const codex = createProvider('codex');
    codex.startLogin
      .mockResolvedValueOnce({
        type: 'external-browser',
        providerId: 'codex',
        loginId: 'login-1',
        url: 'https://example.com/login-1',
      })
      .mockResolvedValueOnce({
        type: 'external-browser',
        providerId: 'codex',
        loginId: 'login-2',
        url: 'https://example.com/login-2',
      });
    const { service } = createService([codex], null, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    await service.startLogin('codex');
    await service.startLogin('codex');

    expect(codex.cancelLogin).toHaveBeenCalledWith('login-1');
    await service.dispose();
    expect(codex.cancelLogin).toHaveBeenCalledWith('login-2');
    expect(timers.size).toBe(0);
    codex.expectInvalidationDisposed();
  });

  it('refreshes only the invalidated Provider', async () => {
    const codex = createProvider('codex');
    const claude = createProvider('claude-code');
    createService([codex, claude]);

    codex.invalidate();
    await vi.waitFor(() => {
      expect(codex.getCredentialState).toHaveBeenCalledOnce();
    });
    expect(claude.getCredentialState).not.toHaveBeenCalled();
  });

  it('isolates listener failures', async () => {
    const codex = createProvider('codex');
    const { service, warn } = createService([codex]);
    const healthyListener = vi.fn();
    service.subscribe(() => {
      throw new Error('listener failed');
    });
    service.subscribe(healthyListener);

    await service.getSetup();

    expect(healthyListener).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Agent Provider 状态监听器执行失败',
      expect.any(Error),
    );
  });
});
