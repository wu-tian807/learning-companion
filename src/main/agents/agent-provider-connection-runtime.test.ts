import { describe, expect, it, vi } from 'vitest';

import type { AgentProviderConnectionConfiguration } from '../../shared/agent-providers';
import type { SettingsRepository } from '../settings/settings-repository';
import type { AgentProvider } from './agent-provider';
import { AgentProviderConnectionCatalog } from './agent-provider-connection-catalog';
import { AgentProviderConnectionRuntime } from './agent-provider-connection-runtime';
import { AgentProviderRegistry } from './agent-provider-registry';
import type { AgentProviderSecretStore } from './agent-provider-secret-file';

const accountConnection: AgentProviderConnectionConfiguration = Object.freeze({
  id: 'codex-account',
  providerId: 'codex',
  kind: 'account',
  displayName: 'ChatGPT 账号',
});

function createProvider(): AgentProvider {
  let loginNumber = 0;
  return {
    id: 'codex',
    displayName: 'Codex',
    description: 'Codex Agent',
    supportedConnectionKinds: ['account', 'api-key'],
    builtInConnections: [accountConnection],
    inspectAccountConnection: vi.fn(async () => ({ status: 'ready' as const })),
    startLogin: vi.fn(async (connection) => {
      loginNumber += 1;
      return {
        type: 'external-browser' as const,
        providerId: 'codex',
        connectionId: connection.id,
        loginId: `login-${loginNumber}`,
        url: 'https://chatgpt.com/login',
      };
    }),
    cancelLogin: vi.fn(async () => undefined),
    getModelCatalog: vi.fn(async (connection) => ({
      providerId: 'codex',
      connectionId: connection.id,
      allowsCustomModel: false,
      models: [],
    })),
    createRunner: vi.fn(({ configuration }) => ({
      providerId: 'codex',
      connectionId: configuration.id,
      async *runTurn() {
        yield* [] as never[];
        throw new Error('not used');
      },
    })),
  };
}

function createManualTimers() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  const setTimer = vi.fn((callback: () => void) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id as unknown as ReturnType<typeof setTimeout>;
  });
  const clearTimer = vi.fn((timer: ReturnType<typeof setTimeout>) => {
    callbacks.delete(timer as unknown as number);
  });
  const runNext = () => {
    const next = callbacks.entries().next();
    if (next.done) {
      throw new Error('No scheduled timer');
    }
    const [id, callback] = next.value;
    callbacks.delete(id);
    callback();
  };
  return { callbacks, clearTimer, runNext, setTimer };
}

interface CreateRuntimeOptions {
  readonly apiKey?: string;
  readonly connections?: readonly AgentProviderConnectionConfiguration[];
  readonly logger?: Pick<Console, 'warn'>;
  readonly probeUrl?: (url: string) => Promise<void>;
}

function createRuntime(
  provider = createProvider(),
  options: CreateRuntimeOptions = {},
) {
  const registry = new AgentProviderRegistry();
  registry.register(provider);
  const settings = {
    listAgentProviderConnections: () => options.connections ?? [],
  } as unknown as SettingsRepository;
  const secrets: AgentProviderSecretStore = {
    get: vi.fn(async () => options.apiKey),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  const timers = createManualTimers();
  const runtime = new AgentProviderConnectionRuntime(
    secrets,
    registry,
    new AgentProviderConnectionCatalog(settings, registry),
    vi.fn(),
    {
      logger: options.logger ?? { warn: vi.fn() },
      loginPollIntervalMs: 1,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      probeUrl: options.probeUrl ?? vi.fn(async () => undefined),
    },
  );
  return { provider, runtime, timers };
}

describe('AgentProviderConnectionRuntime', () => {
  it('polls an account login until the Provider reports it ready', async () => {
    const { provider, runtime, timers } = createRuntime();

    await expect(
      runtime.startLogin(provider, accountConnection),
    ).resolves.toMatchObject({ loginId: 'login-1' });
    expect(timers.callbacks.size).toBe(1);

    timers.runNext();
    await vi.waitFor(() =>
      expect(runtime.snapshot('codex', 'codex-account')).toMatchObject({
        inspection: { status: 'ready' },
        refreshing: false,
      }),
    );

    expect(provider.inspectAccountConnection).toHaveBeenCalledOnce();
    expect(timers.callbacks.size).toBe(0);

    await runtime.dispose();
  });

  it('cancels the previous login before replacing its observer', async () => {
    const { provider, runtime, timers } = createRuntime();

    await runtime.startLogin(provider, accountConnection);
    await runtime.startLogin(provider, accountConnection);

    expect(provider.cancelLogin).toHaveBeenCalledWith(
      accountConnection,
      'login-1',
    );
    expect(timers.callbacks.size).toBe(1);

    await runtime.cancelLogin(provider, accountConnection, 'login-2');
    expect(provider.cancelLogin).toHaveBeenLastCalledWith(
      accountConnection,
      'login-2',
    );
    expect(timers.callbacks.size).toBe(0);

    await runtime.dispose();
  });

  it('ignores a stale refresh result after the Connection is invalidated', async () => {
    let resolveInspection:
      | ((value: { readonly status: 'ready' }) => void)
      | undefined;
    const inspection = new Promise<{ readonly status: 'ready' }>((resolve) => {
      resolveInspection = resolve;
    });
    const provider = createProvider();
    provider.inspectAccountConnection = vi.fn(async () => inspection);
    const { runtime } = createRuntime(provider);

    const refresh = runtime.ensureRefreshed(provider, accountConnection);
    expect(runtime.snapshot('codex', 'codex-account').refreshing).toBe(true);

    runtime.invalidate('codex', 'codex-account');
    resolveInspection?.({ status: 'ready' });
    await refresh;

    expect(runtime.snapshot('codex', 'codex-account')).toMatchObject({
      inspection: { status: 'unconfigured' },
      refreshing: false,
    });

    await runtime.dispose();
  });

  it('keeps API keys out of snapshots and logs when probing fails', async () => {
    const apiKey = 'lc-test-secret-never-log';
    const logger = { warn: vi.fn() };
    const apiConnection: AgentProviderConnectionConfiguration = {
      id: 'codex-api-test',
      providerId: 'codex',
      kind: 'api-key',
      displayName: 'Test API',
      baseUrl: 'https://offline.example',
    };
    const provider = createProvider();
    const { runtime } = createRuntime(provider, {
      apiKey,
      connections: [apiConnection],
      logger,
      probeUrl: vi.fn(async () => {
        throw new Error(`simulated probe failure containing ${apiKey}`);
      }),
    });

    await runtime.ensureRefreshed(provider, apiConnection);

    const snapshot = runtime.snapshot('codex', apiConnection.id);
    expect(snapshot).toMatchObject({
      inspection: { status: 'unavailable' },
      hasApiKey: true,
      refreshing: false,
    });
    expect(JSON.stringify(snapshot)).not.toContain(apiKey);
    expect(logger.warn).not.toHaveBeenCalled();

    await runtime.dispose();
  });
});
