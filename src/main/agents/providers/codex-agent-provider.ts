import type {
  AgentProviderCredentialSnapshot,
  AgentProviderLoginChallenge,
} from '../../../shared/agent-providers';
import type { GenerationTokenUsage } from '../../generation/contracts/generation-metrics';
import type {
  GenerationAgentEvent,
  GenerationAgentTurnRequest,
  GenerationAgentTurnResult,
} from '../../generation/generation-agent-runner';
import { AppError } from '../../errors/app-error';
import type { AgentProvider } from '../agent-provider';
import type { CodexRuntimeServiceApi } from '../codex/codex-runtime-service-api';
import type {
  CodexJsonValue,
} from '../codex/codex-runtime-types';
import type { AgentSessionServiceApi } from '../sessions/agent-session-service';
import {
  CODEX_AGENT_PROVIDER_ID,
  createCodexClientUserMessageId,
  createCodexGenerationConfiguration,
  toCodexUserInput,
  type CodexGenerationConfiguration,
} from './codex-generation-request';
import { inspectCodexGenerationEnvironment } from './codex-generation-environment';
import {
  CodexThreadCoordinator,
  type ResolvedCodexThread,
} from './codex-thread-coordinator';
import {
  codexModelFromReroute,
  codexTokenUsageFromEvent,
  codexTurnTiming,
  findRecoveredCodexTurn,
  parseCodexAgentOutput,
  toGenerationToolEvent,
} from './codex-generation-response';

export { CODEX_AGENT_PROVIDER_ID } from './codex-generation-request';

interface CodexAgentProviderDependencies {
  readonly now: () => number;
}

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export class CodexAgentProvider
  implements AgentProvider
{
  readonly id = CODEX_AGENT_PROVIDER_ID;
  readonly providerId = CODEX_AGENT_PROVIDER_ID;
  readonly displayName = 'Codex';
  readonly description = '使用 ChatGPT 账号运行 Codex。';
  readonly loginLabel = '使用 ChatGPT 登录';

  private readonly dependencies: CodexAgentProviderDependencies;
  private readonly threadCoordinator: CodexThreadCoordinator;

  constructor(
    private readonly runtime: CodexRuntimeServiceApi,
    sessions: AgentSessionServiceApi,
    dependencies: Partial<CodexAgentProviderDependencies> = {},
  ) {
    this.dependencies = { now: dependencies.now ?? Date.now };
    this.threadCoordinator = new CodexThreadCoordinator(
      runtime,
      sessions,
    );
  }

  subscribeCredentialInvalidation(listener: () => void): () => void {
    return this.runtime.subscribe((event) => {
      if (
        event.type === 'state-changed' &&
        (event.snapshot.phase === 'failed' || event.snapshot.phase === 'stopped')
      ) {
        listener();
        return;
      }

      if (
        event.type === 'notification' &&
        event.notification.method.startsWith('account/')
      ) {
        listener();
      }
    });
  }

  async getCredentialState(
    refreshCredentials = false,
  ): Promise<AgentProviderCredentialSnapshot> {
    const state = await this.runtime.getAccount(refreshCredentials);

    if (!state.account) {
      return { status: 'unauthenticated' };
    }

    return {
      status: 'authenticated',
      account: {
        email: optionalText(state.account.email),
        planType: optionalText(state.account.planType),
        authenticationMethod: optionalText(state.account.type),
      },
    };
  }

  async startLogin(): Promise<AgentProviderLoginChallenge> {
    const challenge = await this.runtime.startChatGptLogin('browser');

    if (challenge.type === 'chatgpt') {
      return {
        type: 'external-browser',
        providerId: this.id,
        loginId: challenge.loginId,
        url: challenge.authUrl,
      };
    }

    return {
      type: 'device-code',
      providerId: this.id,
      loginId: challenge.loginId,
      verificationUrl: challenge.verificationUrl,
      userCode: challenge.userCode,
    };
  }

  cancelLogin(loginId: string): Promise<void> {
    return this.runtime.cancelLogin(loginId);
  }

  async *runTurn(
    request: GenerationAgentTurnRequest,
  ): AsyncGenerator<GenerationAgentEvent, GenerationAgentTurnResult> {
    request.signal?.throwIfAborted();
    const account = await this.runtime.getAccount(false);

    if (!account.account) {
      throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
    }

    const environment = await inspectCodexGenerationEnvironment(
      this.runtime,
      request,
    );
    const configuration = createCodexGenerationConfiguration(
      request,
      environment,
    );
    const releaseSession = await this.threadCoordinator.acquire(
      request.sessionLocator,
      request.signal,
    );

    try {
      const resolved = await this.threadCoordinator.resolve(
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
          output: parseCodexAgentOutput(recovered),
          sessionId,
          providerId: this.providerId,
          modelId: resolved.selection.model!.trim(),
          providerExecutionId: recovered.id,
          ...codexTurnTiming(recovered, completedTime, completedTime),
        };
      }

      return yield* this.startCodexTurn(
        request,
        resolved,
        configuration,
        clientUserMessageId,
      );
    } finally {
      releaseSession();
    }
  }

  private async *startCodexTurn(
    request: GenerationAgentTurnRequest,
    resolved: ResolvedCodexThread,
    configuration: CodexGenerationConfiguration,
    clientUserMessageId: string,
  ): AsyncGenerator<GenerationAgentEvent, GenerationAgentTurnResult> {
    const sessionId = resolved.binding.sessionId;
    const startedFallback = this.dependencies.now();
    const stream = this.runtime.startTurn({
      threadId: sessionId,
      clientUserMessageId,
      input: toCodexUserInput(request),
      cwd: request.workspaces.primary.path,
      runtimeWorkspaceRoots: configuration.runtimeWorkspaceRoots,
      approvalPolicy: 'never',
      permissions: configuration.profileId,
      outputSchema: request.outputSchema as CodexJsonValue,
    });
    let activeTurnId: string | undefined;
    let usage: GenerationTokenUsage | undefined;
    let modelId = resolved.selection.model!.trim();
    let interruptTask: Promise<void> | undefined;
    const interrupt = () => {
      if (activeTurnId && !interruptTask) {
        interruptTask = this.runtime
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
            output: parseCodexAgentOutput(next.value.turn),
            sessionId,
            providerId: this.providerId,
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
            request.allowedTools,
          );

          if (toolEvent) {
            yield toolEvent;
          }
        } else if (event.type === 'server-request') {
          await this.runtime.respondToServerRequest(event.request.requestId, {
            error: {
              code: -32_601,
              message: 'Generation task does not allow interactive requests',
            },
          });
          throw new AppError('FEATURE_NOT_SUPPORTED');
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

}
