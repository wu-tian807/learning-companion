import { cloneAgentUserMessage } from './contracts/agent-message';
import type {
  TaskAgentCallRequest,
  TaskAgentCallResult,
  TaskAgentSession,
} from './contracts/task-definition';
import type {
  GenerationAgentRunner,
  GenerationAgentRunnerResolver,
} from './generation-agent-runner';
import type {
  GenerationAgentExecutionEvent,
  GenerationAgentExecutor,
} from './generation-agent-executor';
import type { GenerationTaskDatabaseApi } from './generation-task-database';
import { GenerationTask } from './generation-task';
import type { PreparedGenerationTask } from './preparation/prepared-generation-task';

export interface GenerationTaskAgentSessionDependencies {
  readonly now: () => number;
  readonly emit: (event: GenerationAgentExecutionEvent) => void;
}

function requireCallText(
  value: string,
  field: 'callKey' | 'purpose',
): string {
  const normalized = value.trim();
  const maxLength = field === 'callKey' ? 128 : 64;

  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new Error(`GenerationTask Agent ${field} 数据无效`);
  }

  return normalized;
}

export class GenerationTaskAgentSession implements TaskAgentSession {
  private readonly now: () => number;
  private readonly emit: (event: GenerationAgentExecutionEvent) => void;
  private runner: GenerationAgentRunner | undefined;
  private callActive = false;

  constructor(
    private readonly task: GenerationTask,
    private readonly prepared: PreparedGenerationTask,
    private readonly database: GenerationTaskDatabaseApi,
    private readonly executor: GenerationAgentExecutor,
    private readonly runnerResolver: GenerationAgentRunnerResolver,
    private readonly signal: AbortSignal,
    dependencies: GenerationTaskAgentSessionDependencies,
  ) {
    this.now = dependencies.now;
    this.emit = dependencies.emit;
  }

  get completedCalls(): readonly TaskAgentCallResult[] {
    const snapshot = this.task.getSnapshot();

    return Object.freeze(
      snapshot.agentCalls.map((checkpoint, index) => {
        const metrics = snapshot.metrics.agentExecutions[index]!;

        return Object.freeze({
          callKey: checkpoint.callKey,
          purpose: checkpoint.purpose,
          sessionId: checkpoint.sessionId,
          ...(checkpoint.providerExecutionId
            ? { providerExecutionId: checkpoint.providerExecutionId }
            : {}),
          ...(checkpoint.assistantText
            ? { assistantText: checkpoint.assistantText }
            : {}),
          metrics,
        });
      }),
    );
  }

  async call(request: TaskAgentCallRequest): Promise<TaskAgentCallResult> {
    this.signal.throwIfAborted();
    const callKey = requireCallText(request.callKey, 'callKey');
    const purpose = requireCallText(request.purpose, 'purpose');
    const existing = this.completedCalls.find(
      (call) => call.callKey === callKey,
    );

    if (existing) {
      if (existing.purpose !== purpose) {
        throw new Error(
          `GenerationTask Agent callKey ${callKey} 已用于其他 purpose`,
        );
      }

      return existing;
    }

    if (this.callActive) {
      throw new Error('GenerationTask 不支持并行调用同一 Agent session');
    }

    this.callActive = true;

    try {
      const runner = await this.resolveRunner();
      this.signal.throwIfAborted();
      const expectedSessionId =
        this.task.getSnapshot().agentCalls.at(-1)?.sessionId;
      const executionConfiguration = this.task.getSnapshot();
      const turn = this.executor.run(
        this.prepared,
        runner,
        {
          callKey,
          purpose,
          userMessage: cloneAgentUserMessage(
            request.userMessage ?? this.prepared.defaultUserMessage,
          ),
          ...(expectedSessionId ? { expectedSessionId } : {}),
          ...(executionConfiguration.assignedModelId
            ? { modelId: executionConfiguration.assignedModelId }
            : {}),
          ...(executionConfiguration.assignedReasoningEffort
            ? {
                reasoningEffort:
                  executionConfiguration.assignedReasoningEffort,
              }
            : {}),
        },
        this.signal,
      );
      let next = await turn.next();

      while (!next.done) {
        this.emit(next.value);
        next = await turn.next();
      }

      this.signal.throwIfAborted();
      const completed = next.value;
      const completedTime = Math.max(
        this.now(),
        this.task.getSnapshot().updatedTime,
      );
      this.task.recordAgentCallCompleted({
        checkpoint: {
          callKey,
          purpose,
          completedTime,
          sessionId: completed.metrics.sessionId,
          ...(completed.providerExecutionId
            ? { providerExecutionId: completed.providerExecutionId }
            : {}),
          ...(completed.assistantText
            ? { assistantText: completed.assistantText }
            : {}),
        },
        metrics: completed.metrics,
        updatedTime: completedTime,
      });
      this.database.update(this.task.getSnapshot());
      return this.completedCalls.at(-1)!;
    } finally {
      this.callActive = false;
    }
  }

  private async resolveRunner(): Promise<GenerationAgentRunner> {
    if (this.runner) {
      return this.runner;
    }

    const snapshot = this.task.getSnapshot();
    const assignedProviderId = snapshot.assignedProviderId;
    const assignedConnectionId = snapshot.assignedConnectionId;
    const configuration = assignedProviderId
      ? {
          providerId: assignedProviderId,
          connectionId: assignedConnectionId!,
          ...(snapshot.assignedModelId
            ? { modelId: snapshot.assignedModelId }
            : {}),
          ...(snapshot.assignedReasoningEffort
            ? { reasoningEffort: snapshot.assignedReasoningEffort }
            : {}),
        }
      : await this.runnerResolver.resolveSelectorConfiguration(
          this.prepared.providerSelectorId,
        );
    const runner = await this.runnerResolver.resolveRunner(configuration);
    this.signal.throwIfAborted();

    if (
      assignedProviderId !== undefined &&
      (runner.providerId !== assignedProviderId ||
        runner.connectionId !== assignedConnectionId)
    ) {
      throw new Error('GenerationTask Provider 恢复结果不一致');
    }

    if (assignedProviderId === undefined) {
      const assignedTime = Math.max(
        this.now(),
        this.task.getSnapshot().updatedTime,
      );
      this.task.assignProvider(
        runner.providerId,
        runner.connectionId,
        assignedTime,
        configuration.modelId,
        configuration.reasoningEffort,
      );
      this.database.update(this.task.getSnapshot());
    }

    this.runner = runner;
    return runner;
  }
}
