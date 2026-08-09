import { createHash } from 'node:crypto';

import type {
  AgentProviderConnectionConfiguration,
  AgentProviderLoginChallenge,
  AgentProviderModelCatalogSnapshot,
  AgentProviderModelSnapshot,
} from '../../../shared/agent-providers';
import type { GenerationTokenUsage } from '../../generation/contracts/generation-metrics';
import type { AgentToolRequirement } from '../../generation/contracts/task-definition';
import type {
  GenerationAgentEvent,
  GenerationAgentRunner,
  GenerationAgentTurnRequest,
  GenerationAgentTurnResult,
} from '../../generation/generation-agent-runner';
import { AppError } from '../../errors/app-error';
import type {
  AgentProvider,
  AgentProviderConnectionInspection,
  ResolvedAgentProviderConnection,
} from '../agent-provider';
import type { CodexRuntimeServiceApi } from '../codex/codex-runtime-service-api';
import { AgentFunctionToolRegistry } from '../function-tools/agent-function-tool-registry';
import type { AgentFunctionToolRegistryApi } from '../function-tools/agent-function-tool-registry';
import type { AgentMcpServerLookup } from '../mcp/agent-mcp-service';
import type { AgentSkillLookup } from '../skills/agent-skill-service';
import type { AgentSessionServiceApi } from '../sessions/agent-session-service';
import {
  CODEX_AGENT_PROVIDER_ID,
  createCodexClientUserMessageId,
  createCodexGenerationConfiguration,
  toCodexUserInput,
  type CodexGenerationConfiguration,
  type CodexGenerationConnection,
} from './codex-generation-request';
import { inspectCodexGenerationEnvironment } from './codex-generation-environment';
import {
  resolveCodexGenerationCapabilities,
  type CodexGenerationCapabilitySelection,
} from './codex-generation-capabilities';
import {
  handleCodexGenerationServerRequest,
  resolveCodexGenerationTools,
  type CodexGenerationToolSelection,
} from './codex-function-tools';
import {
  CodexThreadCoordinator,
  type ResolvedCodexThread,
} from './codex-thread-coordinator';
import {
  codexModelFromReroute,
  codexTokenUsageFromEvent,
  codexTurnTiming,
  findRecoveredCodexTurn,
  toGenerationToolEvent,
} from './codex-generation-response';
import {
  normalizeCodexResponsesBaseUrl,
  resolveCodexResponsesEndpointUrl,
} from './codex-responses-url';

export { CODEX_AGENT_PROVIDER_ID } from './codex-generation-request';

export const CODEX_ACCOUNT_CONNECTION_ID = 'codex-account';

const CODEX_DEFAULT_REASONING_EFFORTS = Object.freeze(
  ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map((id) =>
    Object.freeze({ id, displayName: id }),
  ),
);

const CODEX_DEFAULT_MODELS = Object.freeze(
  ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].map(
    (id, index): AgentProviderModelSnapshot =>
      Object.freeze({
        id,
        displayName: id,
        description: 'Learning Companion 默认支持的 Codex 模型。',
        isDefault: index === 0,
        reasoningEfforts: CODEX_DEFAULT_REASONING_EFFORTS,
        defaultReasoningEffort: 'high',
      }),
  ),
);

interface CodexAgentProviderDependencies {
  readonly now: () => number;
  readonly functionTools: AgentFunctionToolRegistryApi;
  readonly skills: AgentSkillLookup;
  readonly mcpServers: AgentMcpServerLookup;
  readonly defaultTools: readonly AgentToolRequirement[];
  readonly createRuntime: (
    environment: Readonly<NodeJS.ProcessEnv>,
  ) => CodexRuntimeServiceApi;
}

interface CodexRuntimeBinding {
  readonly runtime: CodexRuntimeServiceApi;
  readonly generationConnection: CodexGenerationConnection;
  readonly disposeSubscription: () => void;
}

const emptySkillLookup: AgentSkillLookup = Object.freeze({
  get: async () => undefined,
});

const emptyMcpServerLookup: AgentMcpServerLookup = Object.freeze({
  get: async () => undefined,
});

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function apiRuntimeNames(connectionId: string): {
  readonly modelProviderId: string;
  readonly environmentKey: string;
} {
  const suffix = createHash('sha256')
    .update(connectionId)
    .digest('hex')
    .slice(0, 20);
  return Object.freeze({
    modelProviderId: `learning-companion-${suffix}`,
    environmentKey: `LC_AGENT_API_KEY_${suffix.toUpperCase()}`,
  });
}

class CodexConnectionRunner implements GenerationAgentRunner {
  readonly providerId = CODEX_AGENT_PROVIDER_ID;

  constructor(
    readonly connectionId: string,
    private readonly run: (
      request: GenerationAgentTurnRequest,
    ) => AsyncGenerator<GenerationAgentEvent, GenerationAgentTurnResult>,
  ) {}

  runTurn(
    request: GenerationAgentTurnRequest,
  ): AsyncGenerator<GenerationAgentEvent, GenerationAgentTurnResult> {
    return this.run(request);
  }
}

export class CodexAgentProvider implements AgentProvider {
  readonly id = CODEX_AGENT_PROVIDER_ID;
  readonly displayName = 'Codex';
  readonly description = '使用 Codex Agent 执行生成任务。';
  readonly supportedConnectionKinds = Object.freeze([
    'account' as const,
    'api-key' as const,
  ]);
  readonly builtInConnections = Object.freeze([
    Object.freeze({
      id: CODEX_ACCOUNT_CONNECTION_ID,
      providerId: CODEX_AGENT_PROVIDER_ID,
      kind: 'account' as const,
      displayName: 'ChatGPT 账号',
    }),
  ]);
  readonly apiConnectionDefaults = Object.freeze({
    displayName: 'Responses-compatible API',
    baseUrl: 'https://api.openai.com/v1',
  });

  private readonly dependencies: CodexAgentProviderDependencies;
  private readonly threadCoordinator: CodexThreadCoordinator;
  private readonly apiRuntimes = new Map<string, CodexRuntimeBinding>();
  private readonly invalidationListeners = new Set<(connectionId: string) => void>();
  private readonly disposeAccountSubscription: () => void;

  constructor(
    private readonly accountRuntime: CodexRuntimeServiceApi,
    sessions: AgentSessionServiceApi,
    dependencies: Partial<CodexAgentProviderDependencies> = {},
  ) {
    this.dependencies = {
      now: dependencies.now ?? Date.now,
      functionTools:
        dependencies.functionTools ?? new AgentFunctionToolRegistry(),
      skills: dependencies.skills ?? emptySkillLookup,
      mcpServers: dependencies.mcpServers ?? emptyMcpServerLookup,
      defaultTools: Object.freeze(
        (dependencies.defaultTools ?? []).map((tool) =>
          Object.freeze({ ...tool }),
        ),
      ),
      createRuntime: dependencies.createRuntime ?? (() => accountRuntime),
    };
    this.threadCoordinator = new CodexThreadCoordinator(sessions);
    this.disposeAccountSubscription = this.subscribeRuntime(
      accountRuntime,
      CODEX_ACCOUNT_CONNECTION_ID,
    );
  }

  subscribeConnectionInvalidation(
    listener: (connectionId: string) => void,
  ): () => void {
    this.invalidationListeners.add(listener);
    return () => this.invalidationListeners.delete(listener);
  }

  async inspectAccountConnection(
    connection: AgentProviderConnectionConfiguration,
    refreshCredentials = false,
  ): Promise<AgentProviderConnectionInspection> {
    this.requireAccountConnection(connection);
    const state = await this.accountRuntime.getAccount(refreshCredentials);

    if (!state.account) {
      return Object.freeze({ status: 'unconfigured' });
    }

    return Object.freeze({
      status: 'ready',
      account: Object.freeze({
        email: optionalText(state.account.email),
        planType: optionalText(state.account.planType),
        authenticationMethod: optionalText(state.account.type),
      }),
    });
  }

  async startLogin(
    connection: AgentProviderConnectionConfiguration,
  ): Promise<AgentProviderLoginChallenge> {
    this.requireAccountConnection(connection);
    const challenge = await this.accountRuntime.startChatGptLogin('browser');

    if (challenge.type === 'chatgpt') {
      return Object.freeze({
        type: 'external-browser',
        providerId: this.id,
        connectionId: connection.id,
        loginId: challenge.loginId,
        url: challenge.authUrl,
      });
    }

    return Object.freeze({
      type: 'device-code',
      providerId: this.id,
      connectionId: connection.id,
      loginId: challenge.loginId,
      verificationUrl: challenge.verificationUrl,
      userCode: challenge.userCode,
    });
  }

  cancelLogin(
    connection: AgentProviderConnectionConfiguration,
    loginId: string,
  ): Promise<void> {
    this.requireAccountConnection(connection);
    return this.accountRuntime.cancelLogin(loginId);
  }

  normalizeApiConnectionBaseUrl(baseUrl: string): string {
    return normalizeCodexResponsesBaseUrl(baseUrl);
  }

  resolveApiConnectionProbeUrl(
    connection: Extract<
      AgentProviderConnectionConfiguration,
      { readonly kind: 'api-key' }
    >,
  ): string {
    return resolveCodexResponsesEndpointUrl(connection.baseUrl);
  }

  getModelCatalog(
    connection: AgentProviderConnectionConfiguration,
  ): Promise<AgentProviderModelCatalogSnapshot> {
    if (connection.kind === 'api-key') {
      return Promise.resolve(
        Object.freeze({
          providerId: this.id,
          connectionId: connection.id,
          allowsCustomModel: true,
          models: Object.freeze([]),
        }),
      );
    }

    this.requireAccountConnection(connection);
    return Promise.resolve(
      Object.freeze({
        providerId: this.id,
        connectionId: connection.id,
        allowsCustomModel: true,
        models: CODEX_DEFAULT_MODELS,
      }),
    );
  }

  createRunner(
    connection: ResolvedAgentProviderConnection,
  ): GenerationAgentRunner {
    const binding = this.runtimeFor(connection);
    return new CodexConnectionRunner(
      connection.configuration.id,
      (request) =>
        this.runTurn(
          binding.runtime,
          connection.configuration.id,
          binding.generationConnection,
          request,
        ),
    );
  }

  async invalidateConnection(connectionId: string): Promise<void> {
    const binding = this.apiRuntimes.get(connectionId);
    if (!binding) {
      return;
    }
    this.apiRuntimes.delete(connectionId);
    binding.disposeSubscription();
    if (binding.runtime !== this.accountRuntime) {
      await binding.runtime.shutdown().catch(() => undefined);
    }
  }

  async dispose(): Promise<void> {
    this.disposeAccountSubscription();
    const bindings = [...this.apiRuntimes.values()];
    this.apiRuntimes.clear();
    this.invalidationListeners.clear();
    await Promise.all(
      bindings.map(async (binding) => {
        binding.disposeSubscription();
        if (binding.runtime !== this.accountRuntime) {
          await binding.runtime.shutdown().catch(() => undefined);
        }
      }),
    );
  }

  private runtimeFor(
    connection: ResolvedAgentProviderConnection,
  ): CodexRuntimeBinding {
    if (connection.configuration.kind === 'account') {
      this.requireAccountConnection(connection.configuration);
      return {
        runtime: this.accountRuntime,
        generationConnection: Object.freeze({ kind: 'account' }),
        disposeSubscription: () => undefined,
      };
    }

    if (!connection.apiKey) {
      throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
    }

    const existing = this.apiRuntimes.get(connection.configuration.id);
    if (existing) {
      return existing;
    }

    const names = apiRuntimeNames(connection.configuration.id);
    const runtime = this.dependencies.createRuntime({
      [names.environmentKey]: connection.apiKey,
    });
    const binding: CodexRuntimeBinding = Object.freeze({
      runtime,
      generationConnection: Object.freeze({
        kind: 'api-key',
        baseUrl: normalizeCodexResponsesBaseUrl(
          connection.configuration.baseUrl,
        ),
        modelProviderId: names.modelProviderId,
        environmentKey: names.environmentKey,
      }),
      disposeSubscription: this.subscribeRuntime(
        runtime,
        connection.configuration.id,
      ),
    });
    this.apiRuntimes.set(connection.configuration.id, binding);
    return binding;
  }

  private async *runTurn(
    runtime: CodexRuntimeServiceApi,
    connectionId: string,
    generationConnection: CodexGenerationConnection,
    request: GenerationAgentTurnRequest,
  ): AsyncGenerator<GenerationAgentEvent, GenerationAgentTurnResult> {
    request.signal?.throwIfAborted();
    const tools = resolveCodexGenerationTools(
      request,
      this.dependencies.functionTools,
      this.dependencies.defaultTools,
    );
    const capabilities = await resolveCodexGenerationCapabilities(
      request.skills,
      request.mcpServers,
      {
        skills: this.dependencies.skills,
        mcpServers: this.dependencies.mcpServers,
      },
    );

    if (generationConnection.kind === 'account') {
      const account = await runtime.getAccount(false);
      if (!account.account) {
        throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
      }
    }

    const environment = await inspectCodexGenerationEnvironment(runtime, request);
    const configuration = createCodexGenerationConfiguration(
      request,
      environment,
      tools,
      capabilities,
      generationConnection,
    );
    const releaseSession = await this.threadCoordinator.acquire(
      request.sessionLocator,
      request.signal,
    );

    try {
      const resolved = await this.threadCoordinator.resolve(
        runtime,
        request,
        configuration,
      );
      const sessionId = resolved.binding.sessionId;
      yield { type: 'session-resolved', sessionId };

      const clientUserMessageId = createCodexClientUserMessageId(request);
      const recovered = findRecoveredCodexTurn(
        resolved.selection,
        clientUserMessageId,
      );

      if (recovered) {
        const completedTime = this.dependencies.now();
        return {
          sessionId,
          providerId: this.id,
          connectionId,
          modelId: resolved.selection.model!.trim(),
          providerExecutionId: recovered.id,
          ...codexTurnTiming(recovered, completedTime, completedTime),
        };
      }

      return yield* this.startCodexTurn(
        runtime,
        connectionId,
        request,
        resolved,
        configuration,
        tools,
        capabilities,
        clientUserMessageId,
      );
    } finally {
      releaseSession();
    }
  }

  private async *startCodexTurn(
    runtime: CodexRuntimeServiceApi,
    connectionId: string,
    request: GenerationAgentTurnRequest,
    resolved: ResolvedCodexThread,
    configuration: CodexGenerationConfiguration,
    tools: CodexGenerationToolSelection,
    capabilities: CodexGenerationCapabilitySelection,
    clientUserMessageId: string,
  ): AsyncGenerator<GenerationAgentEvent, GenerationAgentTurnResult> {
    const sessionId = resolved.binding.sessionId;
    const startedFallback = this.dependencies.now();
    const stream = runtime.startTurn({
      threadId: sessionId,
      clientUserMessageId,
      input: toCodexUserInput(request, capabilities),
      cwd: request.workspaces.primary.path,
      runtimeWorkspaceRoots: configuration.runtimeWorkspaceRoots,
      approvalPolicy: 'never',
      ...(request.modelId ? { model: request.modelId } : {}),
      ...(request.reasoningEffort ? { effort: request.reasoningEffort } : {}),
    });
    let activeTurnId: string | undefined;
    let usage: GenerationTokenUsage | undefined;
    let modelId = resolved.selection.model!.trim();
    let interruptTask: Promise<void> | undefined;
    const interrupt = () => {
      if (activeTurnId && !interruptTask) {
        interruptTask = runtime
          .interruptTurn({ threadId: sessionId, turnId: activeTurnId })
          .catch(() => undefined);
      }
    };
    request.signal?.addEventListener('abort', interrupt, { once: true });

    try {
      while (true) {
        request.signal?.throwIfAborted();
        const next = await stream.next();

        if (next.done) {
          const completedFallback = this.dependencies.now();
          request.signal?.throwIfAborted();

          if (next.value.turn.status !== 'completed') {
            throw new AppError('CODEX_REQUEST_FAILED', {
              cause: new Error(
                next.value.turn.error?.message ??
                  `Codex Turn 状态：${next.value.turn.status}`,
              ),
            });
          }

          return {
            sessionId,
            providerId: this.id,
            connectionId,
            modelId,
            providerExecutionId: next.value.turn.id,
            ...codexTurnTiming(
              next.value.turn,
              startedFallback,
              completedFallback,
            ),
            ...(usage ? { usage } : {}),
          };
        }

        const event = next.value;
        if (event.type === 'turn-started') {
          activeTurnId = event.turn.id;
        } else if (event.type === 'assistant-message-delta') {
          yield { type: 'assistant-delta', delta: event.delta };
        } else if (
          event.type === 'item-started' ||
          event.type === 'item-completed'
        ) {
          const toolEvent = toGenerationToolEvent(
            event,
            tools,
            capabilities.mcpServerIdsByWireName,
          );
          if (toolEvent) {
            yield toolEvent;
          }
        } else if (event.type === 'server-request') {
          await handleCodexGenerationServerRequest({
            event,
            expectedThreadId: sessionId,
            activeTurnId,
            selection: tools,
            generationRequest: request,
            respond: (requestId, response) =>
              runtime.respondToServerRequest(requestId, response),
          });
        }

        usage = codexTokenUsageFromEvent(event) ?? usage;
        modelId = codexModelFromReroute(event) ?? modelId;
      }
    } finally {
      request.signal?.removeEventListener('abort', interrupt);
      await interruptTask;
      await stream.return(undefined as never).catch(() => undefined);
    }
  }

  private subscribeRuntime(
    runtime: CodexRuntimeServiceApi,
    connectionId: string,
  ): () => void {
    return runtime.subscribe((event) => {
      if (
        event.type === 'state-changed' &&
        (event.snapshot.phase === 'failed' || event.snapshot.phase === 'stopped')
      ) {
        this.notifyInvalidation(connectionId);
      } else if (
        connectionId === CODEX_ACCOUNT_CONNECTION_ID &&
        event.type === 'notification' &&
        event.notification.method.startsWith('account/')
      ) {
        this.notifyInvalidation(connectionId);
      }
    });
  }

  private notifyInvalidation(connectionId: string): void {
    for (const listener of this.invalidationListeners) {
      listener(connectionId);
    }
  }

  private requireAccountConnection(
    connection: AgentProviderConnectionConfiguration,
  ): void {
    if (
      connection.providerId !== this.id ||
      connection.id !== CODEX_ACCOUNT_CONNECTION_ID ||
      connection.kind !== 'account'
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
  }
}
