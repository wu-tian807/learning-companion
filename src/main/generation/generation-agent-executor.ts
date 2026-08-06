import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from '../../shared/workbench/protocol';
import { createAgentSessionLocator } from '../agents/sessions/agent-session';
import { AppError } from '../errors/app-error';
import type { AgentUserMessage } from './contracts/agent-message';
import {
  isGenerationTokenUsage,
  mergeGenerationTokenUsage,
  type GenerationAgentExecutionMetrics,
  type GenerationTokenUsage,
} from './contracts/generation-metrics';
import type { GenerationValidationIssue } from './contracts/generation-validation';
import type {
  GenerationAgentEvent,
  GenerationAgentRunner,
  GenerationAgentTurnResult,
} from './generation-agent-runner';
import type { PreparedGenerationTask } from './preparation/prepared-generation-task';

export type GenerationAgentExecutionEvent =
  | {
      readonly type: 'agent-event';
      readonly event: GenerationAgentEvent;
    }
  | {
      readonly type: 'output-rejected';
      readonly repairTurnNumber: number;
      readonly issues: readonly GenerationValidationIssue[];
    };

export interface CompletedGenerationAgentRun {
  readonly output: JsonValue;
  readonly metrics: GenerationAgentExecutionMetrics;
  readonly providerExecutionId?: string;
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
    !isJsonValue(result.output) ||
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

export class GenerationOutputValidationError extends Error {
  constructor(readonly issues: readonly GenerationValidationIssue[]) {
    super(
      `Agent 输出在修复次数耗尽后仍不符合协议：${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'GenerationOutputValidationError';
  }
}

export class GenerationAgentExecutor {
  async *run(
    prepared: PreparedGenerationTask,
    runner: GenerationAgentRunner,
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
    let userMessage: AgentUserMessage = prepared.userMessage;
    let sessionId: string | undefined;
    let modelId: string | undefined;
    let startedTime: number | undefined;
    let completedTime: number | undefined;
    let activeDurationMs = 0;
    let usage: GenerationTokenUsage | undefined;
    let providerExecutionId: string | undefined;
    let repairTurnCount = 0;

    while (true) {
      signal.throwIfAborted();
      const turn = runner.runTurn({
        taskId: prepared.taskId,
        projectId: prepared.projectId,
        sessionLocator,
        ...(sessionId ? { sessionId } : {}),
        systemInstruction: prepared.systemInstruction,
        userMessage,
        allowedTools: prepared.allowedTools,
        workspaces: prepared.workspaces,
        outputSchema: prepared.outputContract.schema,
        signal,
      });
      let next = await turn.next();

      while (!next.done) {
        yield { type: 'agent-event', event: next.value };
        next = await turn.next();
      }

      const result = next.value;
      signal.throwIfAborted();
      validateTurnResult(result, providerId, sessionId);

      if (modelId !== undefined && modelId !== result.modelId) {
        throw new AppError('CODEX_PROTOCOL_ERROR');
      }

      sessionId = result.sessionId;
      modelId = result.modelId;
      startedTime ??= result.startedTime;
      completedTime = result.completedTime;
      activeDurationMs += result.activeDurationMs;
      usage = mergeGenerationTokenUsage(usage, result.usage);
      providerExecutionId =
        result.providerExecutionId ?? providerExecutionId;
      const validated = prepared.outputContract.validate(result.output, {
        assetReferences: prepared.assetReferences,
      });

      if (validated.ok) {
        signal.throwIfAborted();
        return Object.freeze({
          output: cloneJsonValue(result.output),
          metrics: Object.freeze({
            sessionId,
            providerId,
            modelId,
            startedTime,
            completedTime,
            activeDurationMs,
            turnCount: repairTurnCount + 1,
            repairTurnCount,
            ...(usage ? { usage } : {}),
          }),
          ...(providerExecutionId ? { providerExecutionId } : {}),
        });
      }

      if (repairTurnCount >= prepared.outputContract.maxRepairTurns) {
        throw new GenerationOutputValidationError(validated.issues);
      }

      repairTurnCount += 1;
      yield {
        type: 'output-rejected',
        repairTurnNumber: repairTurnCount,
        issues: Object.freeze(
          validated.issues.map((issue) => Object.freeze({ ...issue })),
        ),
      };
      userMessage = prepared.outputContract.createRepairMessage(
        validated.issues,
        repairTurnCount,
      );
    }
  }
}
