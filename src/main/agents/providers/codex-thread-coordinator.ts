import { AppError } from '../../errors/app-error';
import type { GenerationAgentTurnRequest } from '../../generation/generation-agent-runner';
import type { CodexRuntimeServiceApi } from '../codex/codex-runtime-service-api';
import type { CodexThreadSelection } from '../codex/codex-runtime-types';
import type {
  AgentProviderSessionBinding,
  AgentSessionLocator,
} from '../sessions/agent-session';
import type { AgentSessionServiceApi } from '../sessions/agent-session-service';
import {
  CODEX_AGENT_PROVIDER_ID,
  codexGenerationSessionOperationKey,
  type CodexGenerationConfiguration,
} from './codex-generation-request';
import {
  isMissingCodexThreadError,
  requireCodexThreadSelection,
} from './codex-generation-response';

export interface ResolvedCodexThread {
  readonly binding: AgentProviderSessionBinding;
  readonly selection: CodexThreadSelection;
}

export class CodexThreadCoordinator {
  private readonly operationTails = new Map<string, Promise<void>>();

  constructor(
    private readonly sessions: AgentSessionServiceApi,
  ) {}

  async resolve(
    runtime: CodexRuntimeServiceApi,
    request: GenerationAgentTurnRequest,
    configuration: CodexGenerationConfiguration,
  ): Promise<ResolvedCodexThread> {
    request.signal?.throwIfAborted();
    const existing = await this.sessions.getProviderBinding(
      request.sessionLocator,
      CODEX_AGENT_PROVIDER_ID,
    );

    if (request.sessionId && existing?.sessionId !== request.sessionId) {
      throw new AppError('AGENT_SESSION_CONFLICT');
    }

    if (existing) {
      try {
        const selection = requireCodexThreadSelection(
          await runtime.selectThread({
            threadId: existing.sessionId,
            ...configuration.resumeInput,
          }),
          existing.sessionId,
        );
        return { binding: existing, selection };
      } catch (error) {
        if (request.sessionId || !isMissingCodexThreadError(error)) {
          throw error;
        }
      }
    }

    if (request.sessionId) {
      throw new AppError('AGENT_SESSION_CONFLICT');
    }

    return this.createAndBind(runtime, request, configuration, existing);
  }

  async acquire(
    locator: AgentSessionLocator,
    signal?: AbortSignal,
  ): Promise<() => void> {
    const key = codexGenerationSessionOperationKey(locator);
    const previous = (
      this.operationTails.get(key) ?? Promise.resolve()
    ).catch(() => undefined);
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const tail = previous.then(() => gate);
    this.operationTails.set(key, tail);
    void tail.then(() => {
      if (this.operationTails.get(key) === tail) {
        this.operationTails.delete(key);
      }
    });

    try {
      await this.waitForPredecessor(previous, signal);
      signal?.throwIfAborted();
    } catch (error) {
      releaseGate();
      throw error;
    }

    let released = false;
    return () => {
      if (!released) {
        released = true;
        releaseGate();
      }
    };
  }

  private async createAndBind(
    runtime: CodexRuntimeServiceApi,
    request: GenerationAgentTurnRequest,
    configuration: CodexGenerationConfiguration,
    existing?: AgentProviderSessionBinding,
  ): Promise<ResolvedCodexThread> {
    request.signal?.throwIfAborted();
    const selection = requireCodexThreadSelection(
      await runtime.createThread(configuration.threadInput),
    );
    request.signal?.throwIfAborted();
    const binding = existing
      ? await this.sessions.replaceProviderBinding({
          locator: request.sessionLocator,
          providerId: CODEX_AGENT_PROVIDER_ID,
          expectedSessionId: existing.sessionId,
          sessionId: selection.thread.id,
        })
      : await this.sessions.bindProvider({
          locator: request.sessionLocator,
          providerId: CODEX_AGENT_PROVIDER_ID,
          sessionId: selection.thread.id,
        });

    return { binding, selection };
  }

  private waitForPredecessor(
    predecessor: Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!signal) {
      return predecessor;
    }

    signal.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      void predecessor.then(
        () => {
          signal.removeEventListener('abort', abort);
          resolve();
        },
        (error: unknown) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        },
      );
    });
  }
}
