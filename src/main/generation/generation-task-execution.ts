import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from '../../shared/workbench/protocol';
import { AppError } from '../errors/app-error';
import type { AnyTaskDefinition } from './contracts/task-definition';
import type { GenerationAgentRunner } from './generation-agent-runner';
import {
  GenerationOutputValidationError,
  type GenerationAgentExecutionEvent,
  type GenerationAgentExecutor,
} from './generation-agent-executor';
import type { GenerationTaskDatabaseApi } from './generation-task-database';
import type { GenerationTaskOutputStoreApi } from './generation-task-output-store';
import {
  GenerationTask,
  type GenerationTaskFailurePhase,
  type GenerationTaskSnapshot,
} from './generation-task';
import type { GenerationTaskPreparerApi } from './preparation/generation-task-preparer';
import type { PreparedGenerationTask } from './preparation/prepared-generation-task';

export type GenerationTaskExecutionEvent =
  | {
      readonly type: 'phase';
      readonly phase: 'prepare' | 'agent' | 'post-process';
      readonly state: 'started' | 'completed';
    }
  | GenerationAgentExecutionEvent;

export interface GenerationTaskExecutionResult {
  readonly taskId: string;
  readonly result: JsonValue;
  readonly sessionId: string;
  readonly metrics: GenerationTaskSnapshot['metrics'];
}

export interface GenerationTaskExecutionDependencies {
  readonly now: () => number;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'GenerationTask 执行失败';
}

export class GenerationTaskExecution {
  private readonly now: () => number;

  constructor(
    private readonly database: GenerationTaskDatabaseApi,
    private readonly preparer: GenerationTaskPreparerApi,
    private readonly agentExecutor: GenerationAgentExecutor,
    private readonly outputStore: GenerationTaskOutputStoreApi,
    dependencies: Partial<GenerationTaskExecutionDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async *run(
    task: GenerationTask,
    definition: AnyTaskDefinition,
    runner: GenerationAgentRunner,
    signal: AbortSignal,
  ): AsyncGenerator<
    GenerationTaskExecutionEvent,
    GenerationTaskExecutionResult
  > {
    const initialSnapshot = task.getSnapshot();

    if (initialSnapshot.postProcessed) {
      return this.createResult(initialSnapshot);
    }

    let failurePhase: GenerationTaskFailurePhase = 'prepare';

    try {
      yield { type: 'phase', phase: 'prepare', state: 'started' };
      const prepared = await this.ensurePrepared(task, definition, signal);
      signal.throwIfAborted();
      yield { type: 'phase', phase: 'prepare', state: 'completed' };

      failurePhase = 'agent';
      const output = yield* this.ensureAgentCompleted(
        task,
        prepared,
        runner,
        signal,
      );

      failurePhase = 'post-process';
      const validated = definition.outputContract.validate(output, {
        assetReferences: prepared.assetReferences,
      });

      if (!validated.ok) {
        throw new AppError('DATA_INTEGRITY_ERROR', {
          cause: new GenerationOutputValidationError(validated.issues),
        });
      }

      signal.throwIfAborted();
      yield { type: 'phase', phase: 'post-process', state: 'started' };
      const postProcessStartedTime = this.now();
      const postProcessResult = await definition.postProcessor.postProcess(
        {
          taskId: prepared.taskId,
          projectId: prepared.projectId,
          instruction: prepared.instruction,
          workspaces: prepared.workspaces,
          assetReferences: prepared.assetReferences,
          ...(prepared.preparedData === undefined
            ? {}
            : { preparedData: prepared.preparedData }),
          signal,
        },
        validated.value,
      );
      signal.throwIfAborted();

      if (!isJsonValue(postProcessResult)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      const completedWallTime = this.now();
      const postProcessedTime = this.nextTaskTime(task, completedWallTime);
      task.recordPostProcessed({
        checkpoint: {
          completedTime: postProcessedTime,
          result: postProcessResult,
        },
        durationMs: Math.max(
          0,
          completedWallTime - postProcessStartedTime,
        ),
        updatedTime: postProcessedTime,
      });
      this.database.update(task.getSnapshot());
      yield { type: 'phase', phase: 'post-process', state: 'completed' };
      return this.createResult(task.getSnapshot());
    } catch (error) {
      this.persistFailure(task, failurePhase, error);
      throw error;
    }
  }

  private async ensurePrepared(
    task: GenerationTask,
    definition: AnyTaskDefinition,
    signal: AbortSignal,
  ): Promise<PreparedGenerationTask> {
    const snapshot = task.getSnapshot();

    if (snapshot.prepared) {
      try {
        return await this.preparer.restore(snapshot, definition, signal);
      } catch (error) {
        if (isAbortError(error) || snapshot.agentCompleted) {
          throw error;
        }
      }
    }

    const startedTime = this.now();
    const prepared = await this.preparer.prepare(
      task.getSnapshot(),
      definition,
      signal,
    );
    signal.throwIfAborted();
    const completedWallTime = this.now();
    const completedTime = this.nextTaskTime(task, completedWallTime);
    task.recordPrepared({
      checkpoint: {
        completedTime,
        manifestRef: prepared.manifestRef,
      },
      durationMs: Math.max(0, completedWallTime - startedTime),
      updatedTime: completedTime,
    });
    this.database.update(task.getSnapshot());
    return prepared;
  }

  private async *ensureAgentCompleted(
    task: GenerationTask,
    prepared: PreparedGenerationTask,
    runner: GenerationAgentRunner,
    signal: AbortSignal,
  ): AsyncGenerator<GenerationTaskExecutionEvent, JsonValue> {
    if (task.getSnapshot().agentCompleted) {
      return this.outputStore.read(task.getSnapshot(), prepared);
    }

    yield { type: 'phase', phase: 'agent', state: 'started' };
    const completed = yield* this.agentExecutor.run(
      prepared,
      runner,
      signal,
    );
    signal.throwIfAborted();
    const outputRef = await this.outputStore.write(
      prepared,
      completed.output,
    );
    signal.throwIfAborted();
    const completedTime = this.nextTaskTime(task, this.now());
    task.recordAgentCompleted({
      checkpoint: {
        completedTime,
        sessionId: completed.metrics.sessionId,
        outputRef,
        ...(completed.providerExecutionId
          ? { providerExecutionId: completed.providerExecutionId }
          : {}),
      },
      metrics: completed.metrics,
      updatedTime: completedTime,
    });
    this.database.update(task.getSnapshot());
    yield { type: 'phase', phase: 'agent', state: 'completed' };
    return completed.output;
  }

  private persistFailure(
    task: GenerationTask,
    phase: GenerationTaskFailurePhase,
    error: unknown,
  ): void {
    if (
      isAbortError(error) ||
      task.getStatus() === 'cancelled' ||
      task.getStatus() === 'post-processed'
    ) {
      return;
    }

    const failureTime = this.nextTaskTime(task, this.now());
    task.recordFailure({
      phase,
      failedTime: failureTime,
      message: errorMessage(error),
      ...(error instanceof AppError ? { code: error.code } : {}),
    });
    this.database.update(task.getSnapshot());
  }

  private createResult(
    snapshot: GenerationTaskSnapshot,
  ): GenerationTaskExecutionResult {
    if (!snapshot.agentCompleted || !snapshot.postProcessed) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return Object.freeze({
      taskId: snapshot.id,
      result: cloneJsonValue(snapshot.postProcessed.result),
      sessionId: snapshot.agentCompleted.sessionId,
      metrics: snapshot.metrics,
    });
  }

  private nextTaskTime(task: GenerationTask, candidate: number): number {
    return Math.max(candidate, task.getSnapshot().updatedTime);
  }
}
