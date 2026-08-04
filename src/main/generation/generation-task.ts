import {
  appendGenerationAgentExecution,
  emptyGenerationTaskMetrics,
  type GenerationAgentExecutionMetrics,
  withGenerationPhaseDuration,
} from './contracts/generation-metrics';
import {
  cloneGenerationTaskSnapshot,
  type CreateGenerationTaskInput,
  type GenerationTaskAgentCheckpoint,
  type GenerationTaskFailure,
  type GenerationTaskPostProcessCheckpoint,
  type GenerationTaskPreparedCheckpoint,
  type GenerationTaskSnapshot,
  type GenerationTaskStatus,
} from './contracts/generation-task-state';

export {
  cloneGenerationTaskSnapshot,
  type CreateGenerationTaskInput,
  type GenerationTaskAgentCheckpoint,
  type GenerationTaskFailure,
  type GenerationTaskFailurePhase,
  type GenerationTaskPostProcessCheckpoint,
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

    if (this.snapshot.postProcessed) {
      return 'post-processed';
    }

    if (this.snapshot.agentCompleted) {
      return 'agent-completed';
    }

    return this.snapshot.prepared ? 'prepared' : 'created';
  }

  recordPrepared(input: {
    readonly checkpoint: GenerationTaskPreparedCheckpoint;
    readonly durationMs: number;
    readonly updatedTime: number;
  }): void {
    this.requireActive();

    if (this.snapshot.agentCompleted) {
      throw new Error('GenerationTask 已执行 Agent，不能替换 prepare checkpoint');
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

  recordAgentCompleted(input: {
    readonly checkpoint: GenerationTaskAgentCheckpoint;
    readonly metrics: GenerationAgentExecutionMetrics;
    readonly updatedTime: number;
  }): void {
    this.requireActive();

    if (!this.snapshot.prepared || this.snapshot.agentCompleted) {
      throw new Error('GenerationTask agent checkpoint 顺序无效');
    }

    this.replace({
      ...this.snapshot,
      agentCompleted: input.checkpoint,
      metrics: appendGenerationAgentExecution(
        this.snapshot.metrics,
        input.metrics,
      ),
      failure: undefined,
      updatedTime: input.updatedTime,
    });
  }

  recordPostProcessed(input: {
    readonly checkpoint: GenerationTaskPostProcessCheckpoint;
    readonly durationMs: number;
    readonly updatedTime: number;
  }): void {
    this.requireActive();

    if (!this.snapshot.agentCompleted || this.snapshot.postProcessed) {
      throw new Error('GenerationTask post-process checkpoint 顺序无效');
    }

    this.replace({
      ...this.snapshot,
      postProcessed: input.checkpoint,
      metrics: withGenerationPhaseDuration(
        this.snapshot.metrics,
        'post-process',
        input.durationMs,
      ),
      failure: undefined,
      updatedTime: input.updatedTime,
    });
  }

  recordFailure(failure: GenerationTaskFailure): void {
    this.requireActive();

    if (this.snapshot.postProcessed) {
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

    if (this.snapshot.postProcessed) {
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
