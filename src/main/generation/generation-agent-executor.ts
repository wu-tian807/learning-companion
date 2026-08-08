import { createAgentSessionLocator } from '../agents/sessions/agent-session';
import { AppError } from '../errors/app-error';
import type { AgentUserMessage } from './contracts/agent-message';
import {
  isGenerationTokenUsage,
  type GenerationAgentExecutionMetrics,
} from './contracts/generation-metrics';
import type {
  GenerationAgentEvent,
  GenerationAgentRunner,
  GenerationAgentTurnResult,
} from './generation-agent-runner';
import type { PreparedGenerationTask } from './preparation/prepared-generation-task';

export type GenerationAgentExecutionEvent = {
  readonly type: 'agent-event';
  readonly event: GenerationAgentEvent;
};

export interface CompletedGenerationAgentRun {
  readonly metrics: GenerationAgentExecutionMetrics;
  readonly providerExecutionId?: string;
}

export interface GenerationAgentExecutionRequest {
  readonly callKey: string;
  readonly purpose: string;
  readonly userMessage: AgentUserMessage;
  readonly expectedSessionId?: string;
}

function requireProviderId(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error('GenerationAgentRunner providerId 不能为空');
  }

  return normalized;
}

function validateTurnResult(
  result: GenerationAgentTurnResult,
  runnerProviderId: string,
  expectedSessionId: string | undefined,
): void {
  if (
    result.sessionId.trim().length === 0 ||
    result.providerId !== runnerProviderId ||
    result.modelId.trim().length === 0 ||
    !Number.isSafeInteger(result.startedTime) ||
    result.startedTime < 0 ||
    !Number.isSafeInteger(result.completedTime) ||
    result.completedTime < result.startedTime ||
    !Number.isFinite(result.activeDurationMs) ||
    result.activeDurationMs < 0 ||
    (result.usage !== undefined &&
      !isGenerationTokenUsage(result.usage)) ||
    (expectedSessionId !== undefined &&
      result.sessionId !== expectedSessionId)
  ) {
    throw new AppError('CODEX_PROTOCOL_ERROR');
  }
}

export class GenerationAgentExecutor {
  async *run(
    prepared: PreparedGenerationTask,
    runner: GenerationAgentRunner,
    request: GenerationAgentExecutionRequest,
    signal: AbortSignal,
  ): AsyncGenerator<
    GenerationAgentExecutionEvent,
    CompletedGenerationAgentRun
  > {
    const providerId = requireProviderId(runner.providerId);
    const sessionLocator = createAgentSessionLocator({
      projectId: prepared.projectId,
      workspaceKey: prepared.workspaces.primary.key,
      instanceKey: prepared.workspaces.primary.instanceKey,
    });
    signal.throwIfAborted();
    const turn = runner.runTurn({
      taskId: prepared.taskId,
      callKey: request.callKey,
      projectId: prepared.projectId,
      sessionLocator,
      ...(request.expectedSessionId
        ? { sessionId: request.expectedSessionId }
        : {}),
      systemInstruction: prepared.systemInstruction,
      userMessage: request.userMessage,
      toolRequirements: prepared.toolRequirements,
      skills: prepared.skills,
      mcpServers: prepared.mcpServers,
      workspaces: prepared.workspaces,
      signal,
    });
    let next = await turn.next();

    while (!next.done) {
      yield { type: 'agent-event', event: next.value };
      next = await turn.next();
    }

    const result = next.value;
    signal.throwIfAborted();
    validateTurnResult(result, providerId, request.expectedSessionId);

    return Object.freeze({
      metrics: Object.freeze({
        callKey: request.callKey,
        purpose: request.purpose,
        sessionId: result.sessionId,
        providerId,
        modelId: result.modelId,
        startedTime: result.startedTime,
        completedTime: result.completedTime,
        activeDurationMs: result.activeDurationMs,
        turnCount: 1,
        repairTurnCount: request.purpose === 'repair' ? 1 : 0,
        ...(result.usage ? { usage: result.usage } : {}),
      }),
      ...(result.providerExecutionId
        ? { providerExecutionId: result.providerExecutionId }
        : {}),
    });
  }
}
