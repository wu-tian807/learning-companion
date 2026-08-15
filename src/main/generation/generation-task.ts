import {
  appendGenerationAgentExecution,
  emptyGenerationTaskMetrics,
  type GenerationAgentExecutionMetrics,
  withGenerationPhaseDuration,
} from './contracts/generation-metrics';
import {
  cloneGenerationTaskSnapshot,
  type CreateGenerationTaskInput,
  type GenerationTaskAgentCallCheckpoint,
  type GenerationTaskCompletedCheckpoint,
  type GenerationTaskFailure,
  type GenerationTaskPreparedCheckpoint,
  type GenerationTaskSnapshot,
  type GenerationTaskStatus,
} from './contracts/generation-task-state';
import type { PreparedGenerationAssetReferenceBindings } from './contracts/generation-asset-reference';

export {
  cloneGenerationTaskSnapshot,
  type CreateGenerationTaskInput,
  type GenerationTaskAgentCallCheckpoint,
  type GenerationTaskCompletedCheckpoint,
  type GenerationTaskFailure,
  type GenerationTaskFailurePhase,
  type GenerationTaskPreparedCheckpoint,
  type GenerationTaskSnapshot,
  type GenerationTaskStatus,
} from './contracts/generation-task-state';

export class GenerationTask {
  private snapshot: GenerationTaskSnapshot;

  constructor(snapshot: GenerationTaskSnapshot) {
    this.snapshot = cloneGenerationTaskSnapshot(snapshot);
  }

  static create(input: CreateGenerationTaskInput): GenerationTask {
    return new GenerationTask({
      id: input.id,
      projectId: input.projectId,
      definitionId: input.definitionId,
      definitionVersion: input.definitionVersion,
      instruction: input.instruction,
      assetReferences: input.assetReferences,
      ...(input.assignedProviderId
        ? { assignedProviderId: input.assignedProviderId }
        : {}),
      ...(input.assignedConnectionId
        ? { assignedConnectionId: input.assignedConnectionId }
        : {}),
      ...(input.assignedModelId
        ? { assignedModelId: input.assignedModelId }
        : {}),
      ...(input.assignedReasoningEffort
        ? { assignedReasoningEffort: input.assignedReasoningEffort }
        : {}),
      agentCalls: Object.freeze([]),
      metrics: emptyGenerationTaskMetrics(),
      createdTime: input.createdTime,
      updatedTime: input.createdTime,
    });
  }

  getSnapshot(): GenerationTaskSnapshot {
    return cloneGenerationTaskSnapshot(this.snapshot);
  }

  getStatus(): GenerationTaskStatus {
    if (this.snapshot.cancelledTime !== undefined) {
      return 'cancelled';
    }

    if (this.snapshot.failure) {
      return 'failed';
    }

    if (this.snapshot.completed) {
      return 'completed';
    }

    if (
      (this.snapshot.prepared && this.snapshot.assignedProviderId) ||
      this.snapshot.agentCalls.length > 0
    ) {
      return 'processing';
    }

    return this.snapshot.prepared ? 'prepared' : 'created';
  }

  assignProvider(
    providerId: string,
    connectionId: string,
    updatedTime: number,
    modelId?: string,
    reasoningEffort?: string,
  ): void {
    this.requireActive();

    if (!this.snapshot.prepared || this.snapshot.completed) {
      throw new Error('GenerationTask Provider 分配顺序无效');
    }

    if (this.snapshot.assignedProviderId) {
      if (
        this.snapshot.assignedProviderId !== providerId ||
        this.snapshot.assignedConnectionId !== connectionId ||
        this.snapshot.assignedModelId !== modelId ||
        this.snapshot.assignedReasoningEffort !== reasoningEffort
      ) {
        throw new Error('GenerationTask 已固定到其他 Provider');
      }
      return;
    }

    this.replace({
      ...this.snapshot,
      assignedProviderId: providerId,
      assignedConnectionId: connectionId,
      ...(modelId ? { assignedModelId: modelId } : {}),
      ...(reasoningEffort
        ? { assignedReasoningEffort: reasoningEffort }
        : {}),
      failure: undefined,
      updatedTime,
    });
  }

  recordPrepared(input: {
    readonly checkpoint: GenerationTaskPreparedCheckpoint;
    readonly durationMs: number;
    readonly updatedTime: number;
  }): void {
    this.requireActive();

    if (
      this.snapshot.agentCalls.length > 0 ||
      this.snapshot.completed
    ) {
      throw new Error('GenerationTask 已进入 process，不能替换 prepare checkpoint');
    }

    this.replace({
      ...this.snapshot,
      prepared: input.checkpoint,
      metrics: withGenerationPhaseDuration(
        this.snapshot.metrics,
        'prepare',
        input.durationMs,
      ),
      failure: undefined,
      updatedTime: input.updatedTime,
    });
  }

  migrateLegacyPreparedCheckpoint(
    assetReferences: PreparedGenerationAssetReferenceBindings,
  ): void {
    this.requireActive();
    const prepared = this.snapshot.prepared;

    if (!prepared || this.snapshot.completed) {
      throw new Error('GenerationTask prepare checkpoint 迁移顺序无效');
    }

    if (prepared.assetReferences !== undefined) {
      return;
    }

    this.replace({
      ...this.snapshot,
      prepared: {
        completedTime: prepared.completedTime,
        assetReferences,
      },
    });
  }

  recordAgentCallCompleted(input: {
    readonly checkpoint: GenerationTaskAgentCallCheckpoint;
    readonly metrics: GenerationAgentExecutionMetrics;
    readonly updatedTime: number;
  }): void {
    this.requireActive();

    const previousSessionId = this.snapshot.agentCalls.at(-1)?.sessionId;

    if (
      !this.snapshot.prepared ||
      !this.snapshot.assignedProviderId ||
      !this.snapshot.assignedConnectionId ||
      this.snapshot.completed ||
      input.metrics.providerId !== this.snapshot.assignedProviderId ||
      input.metrics.connectionId !== this.snapshot.assignedConnectionId ||
      input.checkpoint.callKey !== input.metrics.callKey ||
      input.checkpoint.purpose !== input.metrics.purpose ||
      input.checkpoint.sessionId !== input.metrics.sessionId ||
      (previousSessionId !== undefined &&
        input.checkpoint.sessionId !== previousSessionId) ||
      this.snapshot.agentCalls.some(
        ({ callKey }) => callKey === input.checkpoint.callKey,
      )
    ) {
      throw new Error('GenerationTask Agent call checkpoint 顺序无效');
    }

    this.replace({
      ...this.snapshot,
      agentCalls: Object.freeze([
        ...this.snapshot.agentCalls,
        input.checkpoint,
      ]),
      metrics: appendGenerationAgentExecution(
        this.snapshot.metrics,
        input.metrics,
      ),
      failure: undefined,
      updatedTime: input.updatedTime,
    });
  }

  recordCompleted(input: {
    readonly checkpoint: GenerationTaskCompletedCheckpoint;
    readonly durationMs: number;
    readonly updatedTime: number;
  }): void {
    this.requireActive();

    if (!this.snapshot.prepared || this.snapshot.completed) {
      throw new Error('GenerationTask process checkpoint 顺序无效');
    }

    this.replace({
      ...this.snapshot,
      completed: input.checkpoint,
      metrics: withGenerationPhaseDuration(
        this.snapshot.metrics,
        'process',
        input.durationMs,
      ),
      failure: undefined,
      updatedTime: input.updatedTime,
    });
  }

  clearFailure(updatedTime: number): void {
    this.requireActive();

    if (!this.snapshot.failure) {
      return;
    }

    this.replace({
      ...this.snapshot,
      failure: undefined,
      updatedTime,
    });
  }

  recordFailure(failure: GenerationTaskFailure): void {
    this.requireActive();

    if (this.snapshot.completed) {
      throw new Error('已完成的 GenerationTask 不能记录失败');
    }

    this.replace({
      ...this.snapshot,
      failure,
      updatedTime: failure.failedTime,
    });
  }

  cancel(cancelledTime: number): void {
    if (this.snapshot.cancelledTime !== undefined) {
      return;
    }

    if (this.snapshot.completed) {
      throw new Error('已完成的 GenerationTask 不能取消');
    }

    this.replace({
      ...this.snapshot,
      failure: undefined,
      cancelledTime,
      updatedTime: cancelledTime,
    });
  }

  private requireActive(): void {
    if (this.snapshot.cancelledTime !== undefined) {
      throw new Error('GenerationTask 已取消');
    }
  }

  private replace(snapshot: GenerationTaskSnapshot): void {
    this.snapshot = cloneGenerationTaskSnapshot(snapshot);
  }
}
