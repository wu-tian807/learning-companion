import { cloneAgentUserMessage } from './contracts/agent-message';
import type {
  AgentMcpServerRequirement,
  AgentSkillRequirement,
  AgentToolRequirement,
  TaskAgentCallRequest,
  TaskAgentCallResult,
  TaskAgentSession,
} from './contracts/task-definition';
import { requireAgentCapabilityId } from '../agents/capabilities/agent-capability-id';
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

function requireSessionKey(value: string): string {
  const normalized = value.trim();

  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(normalized)) {
    throw new Error('GenerationTask Agent sessionKey 数据无效');
  }

  return normalized;
}

function requireSystemInstruction(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error('GenerationTask Agent systemInstruction 不能为空');
  }

  return normalized;
}

function cloneToolRequirements(
  requirements: readonly AgentToolRequirement[],
): readonly AgentToolRequirement[] {
  const cloned = requirements.map(({ id, availability }) => {
    const normalizedId = id.trim();

    if (
      normalizedId.length === 0 ||
      (availability !== 'required' && availability !== 'optional')
    ) {
      throw new Error('GenerationTask Agent tool requirement 数据无效');
    }

    return Object.freeze({ id: normalizedId, availability });
  });

  if (new Set(cloned.map(({ id }) => id)).size !== cloned.length) {
    throw new Error('GenerationTask Agent tool requirement 重复');
  }

  return Object.freeze(cloned);
}

function cloneCapabilityRequirements<
  T extends AgentSkillRequirement | AgentMcpServerRequirement,
>(requirements: readonly T[]): readonly T[] {
  const cloned = requirements.map(({ id, availability }) => {
    if (availability !== 'required' && availability !== 'optional') {
      throw new Error('GenerationTask Agent capability requirement 数据无效');
    }

    return Object.freeze({
      id: requireAgentCapabilityId(id),
      availability,
    }) as T;
  });

  if (new Set(cloned.map(({ id }) => id)).size !== cloned.length) {
    throw new Error('GenerationTask Agent capability requirement 重复');
  }

  return Object.freeze(cloned);
}

export class GenerationTaskAgentSession implements TaskAgentSession {
  private readonly now: () => number;
  private readonly emit: (event: GenerationAgentExecutionEvent) => void;
  private runner: GenerationAgentRunner | undefined;
  private runnerPromise: Promise<GenerationAgentRunner> | undefined;
  private readonly activeSessionKeys = new Set<string>();
  private readonly activeCallKeys = new Set<string>();

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
          ...(checkpoint.sessionKey
            ? { sessionKey: checkpoint.sessionKey }
            : {}),
          sessionId: checkpoint.sessionId,
          ...(checkpoint.providerExecutionId
            ? { providerExecutionId: checkpoint.providerExecutionId }
            : {}),
          ...(checkpoint.assistantOutput === undefined
            ? {}
            : { assistantOutput: checkpoint.assistantOutput }),
          metrics,
        });
      }),
    );
  }

  async call(request: TaskAgentCallRequest): Promise<TaskAgentCallResult> {
    this.signal.throwIfAborted();
    const callKey = requireCallText(request.callKey, 'callKey');
    const purpose = requireCallText(request.purpose, 'purpose');
    const sessionKey = request.sessionKey
      ? requireSessionKey(request.sessionKey)
      : undefined;
    const activeSessionKey = sessionKey ?? '__default__';
    const systemInstruction = requireSystemInstruction(
      request.systemInstruction,
    );
    const userMessage = cloneAgentUserMessage(request.userMessage);
    const toolRequirements = cloneToolRequirements(
      request.toolRequirements,
    );
    const skills = cloneCapabilityRequirements(request.skills);
    const mcpServers = cloneCapabilityRequirements(request.mcpServers);
    const existing = this.completedCalls.find(
      (call) => call.callKey === callKey,
    );

    if (existing) {
      if (
        existing.purpose !== purpose ||
        existing.sessionKey !== sessionKey
      ) {
        throw new Error(
          `GenerationTask Agent callKey ${callKey} 已用于其他调用`,
        );
      }

      return existing;
    }

    if (
      this.activeCallKeys.has(callKey) ||
      this.activeSessionKeys.has(activeSessionKey)
    ) {
      throw new Error('GenerationTask 不支持并行调用同一 Agent session');
    }

    this.activeCallKeys.add(callKey);
    this.activeSessionKeys.add(activeSessionKey);

    try {
      const runner = await this.resolveRunner();
      this.signal.throwIfAborted();
      const expectedSessionId = this.task
        .getSnapshot()
        .agentCalls.slice()
        .reverse()
        .find(
          (checkpoint) => checkpoint.sessionKey === sessionKey,
        )?.sessionId;
      const executionConfiguration = this.task.getSnapshot();
      const turn = this.executor.run(
        this.prepared,
        runner,
        {
          callKey,
          purpose,
          ...(sessionKey ? { sessionKey } : {}),
          systemInstruction,
          userMessage,
          toolRequirements,
          skills,
          mcpServers,
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
        const agentEvent = next.value.event;
        const isAssistantEvent =
          agentEvent.type === 'assistant-delta' ||
          agentEvent.type === 'assistant-completed';
        if (
          !isAssistantEvent ||
          (request.assistantEvents ?? 'runtime') === 'runtime'
        ) {
          this.emit(next.value);
        }
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
          ...(sessionKey ? { sessionKey } : {}),
          completedTime,
          sessionId: completed.metrics.sessionId,
          ...(completed.providerExecutionId
            ? { providerExecutionId: completed.providerExecutionId }
            : {}),
          assistantOutput: completed.assistantOutput,
        },
        metrics: completed.metrics,
        updatedTime: completedTime,
      });
      this.database.update(this.task.getSnapshot());
      return this.completedCalls.find((call) => call.callKey === callKey)!;
    } finally {
      this.activeCallKeys.delete(callKey);
      this.activeSessionKeys.delete(activeSessionKey);
    }
  }

  private async resolveRunner(): Promise<GenerationAgentRunner> {
    if (this.runner) {
      return this.runner;
    }

    if (!this.runnerPromise) {
      this.runnerPromise = this.loadRunner();
    }

    try {
      this.runner = await this.runnerPromise;
      return this.runner;
    } catch (error) {
      this.runnerPromise = undefined;
      throw error;
    }
  }

  private async loadRunner(): Promise<GenerationAgentRunner> {
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

    return runner;
  }
}
