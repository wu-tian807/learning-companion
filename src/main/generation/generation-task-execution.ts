import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from '../../shared/workbench/protocol';
import { AppError, describeAppError } from '../errors/app-error';
import type { AnyTaskDefinition } from './contracts/task-definition';
import type { GenerationValidationIssue } from './contracts/generation-validation';
import type { GenerationAgentRunnerResolver } from './generation-agent-runner';
import type {
  GenerationAgentExecutionEvent,
  GenerationAgentExecutor,
} from './generation-agent-executor';
import { GenerationTaskAgentSession } from './generation-task-agent-session';
import type { GenerationTaskDatabaseApi } from './generation-task-database';
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
      readonly phase: 'prepare' | 'process';
      readonly state: 'started' | 'completed';
    }
  | {
      readonly type: 'output-rejected';
      readonly repairTurnNumber: number;
      readonly issues: readonly GenerationValidationIssue[];
    }
  | GenerationAgentExecutionEvent;

export interface GenerationTaskExecutionResult {
  readonly taskId: string;
  readonly result: JsonValue;
  readonly sessionId?: string;
  readonly metrics: GenerationTaskSnapshot['metrics'];
}

export interface GenerationTaskExecutionDependencies {
  readonly now: () => number;
}

class ExecutionEventBuffer {
  private readonly events: GenerationTaskExecutionEvent[] = [];
  private wake: (() => void) | undefined;

  push(event: GenerationTaskExecutionEvent): void {
    this.events.push(event);
    this.wake?.();
    this.wake = undefined;
  }

  shift(): GenerationTaskExecutionEvent | undefined {
    return this.events.shift();
  }

  get empty(): boolean {
    return this.events.length === 0;
  }

  async wait(): Promise<void> {
    if (!this.empty) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.wake = resolve;
    });
  }

  notify(): void {
    this.wake?.();
    this.wake = undefined;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

function cloneIssues(
  issues: readonly GenerationValidationIssue[],
): readonly GenerationValidationIssue[] {
  if (
    issues.length === 0 ||
    issues.some(
      ({ path, message }) =>
        typeof path !== 'string' || message.trim().length === 0,
    )
  ) {
    throw new Error('Generation output rejection issues 数据无效');
  }

  return Object.freeze(
    issues.map(({ path, message }) =>
      Object.freeze({ path, message: message.trim() }),
    ),
  );
}

export class GenerationTaskExecution {
  private readonly now: () => number;

  constructor(
    private readonly database: GenerationTaskDatabaseApi,
    private readonly preparer: GenerationTaskPreparerApi,
    private readonly agentExecutor: GenerationAgentExecutor,
    dependencies: Partial<GenerationTaskExecutionDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async *run(
    task: GenerationTask,
    definition: AnyTaskDefinition,
    runnerResolver: GenerationAgentRunnerResolver,
    signal: AbortSignal,
  ): AsyncGenerator<
    GenerationTaskExecutionEvent,
    GenerationTaskExecutionResult
  > {
    const initialSnapshot = task.getSnapshot();

    if (initialSnapshot.completed) {
      return this.createResult(initialSnapshot);
    }

    if (initialSnapshot.failure) {
      const resumedTime = this.nextTaskTime(task, this.now());
      task.clearFailure(resumedTime);
      this.database.update(task.getSnapshot());
    }

    let failurePhase: GenerationTaskFailurePhase = 'prepare';

    try {
      yield { type: 'phase', phase: 'prepare', state: 'started' };
      const prepared = await this.ensurePrepared(task, definition, signal);
      signal.throwIfAborted();
      yield { type: 'phase', phase: 'prepare', state: 'completed' };

      failurePhase = 'process';
      yield { type: 'phase', phase: 'process', state: 'started' };
      const recoveredAgentDuration = task
        .getSnapshot()
        .metrics.agentExecutions.reduce(
          (total, execution) => total + execution.activeDurationMs,
          0,
        );
      const processStartedTime = this.now();
      const processResult = yield* this.runProcess(
        task,
        prepared,
        definition,
        runnerResolver,
        signal,
      );
      signal.throwIfAborted();

      if (!isJsonValue(processResult)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      const completedWallTime = this.now();
      const completedTime = this.nextTaskTime(task, completedWallTime);
      const allAgentDuration = task
        .getSnapshot()
        .metrics.agentExecutions.reduce(
          (total, execution) => total + execution.activeDurationMs,
          0,
        );
      task.recordCompleted({
        checkpoint: {
          completedTime,
          result: processResult,
        },
        durationMs: Math.max(
          allAgentDuration,
          recoveredAgentDuration +
            Math.max(0, completedWallTime - processStartedTime),
        ),
        updatedTime: completedTime,
      });
      this.database.update(task.getSnapshot());
      yield { type: 'phase', phase: 'process', state: 'completed' };
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
        const prepared = await this.preparer.restore(
          snapshot,
          definition,
          signal,
        );

        if (snapshot.prepared.legacyManifestRef !== undefined) {
          task.migrateLegacyPreparedCheckpoint(
            prepared.assetReferences,
          );
          this.database.update(task.getSnapshot());
        }

        return prepared;
      } catch (error) {
        if (
          isAbortError(error) ||
          snapshot.assignedProviderId !== undefined ||
          snapshot.agentCalls.length > 0
        ) {
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
        assetReferences: prepared.assetReferences,
      },
      durationMs: Math.max(0, completedWallTime - startedTime),
      updatedTime: completedTime,
    });
    this.database.update(task.getSnapshot());
    return prepared;
  }

  private async *runProcess(
    task: GenerationTask,
    prepared: PreparedGenerationTask,
    definition: AnyTaskDefinition,
    runnerResolver: GenerationAgentRunnerResolver,
    signal: AbortSignal,
  ): AsyncGenerator<GenerationTaskExecutionEvent, JsonValue> {
    const events = new ExecutionEventBuffer();
    const agent = new GenerationTaskAgentSession(
      task,
      prepared,
      this.database,
      this.agentExecutor,
      runnerResolver,
      signal,
      {
        now: this.now,
        emit: (event) => events.push(event),
      },
    );
    let settled = false;
    const process = Promise.resolve()
      .then(() =>
        definition.process({
          taskId: prepared.taskId,
          projectId: prepared.projectId,
          instruction: prepared.instruction,
          workspaces: prepared.workspaces,
          assetReferences: prepared.assetReferences,
          preparedUserMessage: prepared.preparedUserMessage,
          agent,
          signal,
          reportStatus(message) {
            const normalized = message.trim();

            if (normalized.length === 0) {
              throw new Error('Generation process status 不能为空');
            }

            events.push({
              type: 'agent-event',
              event: { type: 'status', message: normalized },
            });
          },
          reportOutputRejected(repairTurnNumber, issues) {
            if (
              !Number.isSafeInteger(repairTurnNumber) ||
              repairTurnNumber <= 0
            ) {
              throw new Error('Generation repair turn number 数据无效');
            }

            events.push({
              type: 'output-rejected',
              repairTurnNumber,
              issues: cloneIssues(issues),
            });
          },
        }),
      )
      .finally(() => {
        settled = true;
        events.notify();
      });

    while (!settled || !events.empty) {
      let event = events.shift();

      while (event) {
        yield event;
        event = events.shift();
      }

      if (!settled) {
        await events.wait();
      }
    }

    return await process;
  }

  private persistFailure(
    task: GenerationTask,
    phase: GenerationTaskFailurePhase,
    error: unknown,
  ): void {
    if (
      isAbortError(error) ||
      task.getStatus() === 'cancelled' ||
      task.getStatus() === 'completed'
    ) {
      return;
    }

    const failureTime = this.nextTaskTime(task, this.now());
    const description = describeAppError(error);
    task.recordFailure({
      phase,
      failedTime: failureTime,
      message: description.userMessage ?? 'GenerationTask 执行失败',
      code: description.code,
      ...(description.detail ? { detail: description.detail } : {}),
    });
    this.database.update(task.getSnapshot());
  }

  private createResult(
    snapshot: GenerationTaskSnapshot,
  ): GenerationTaskExecutionResult {
    if (!snapshot.completed) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const sessionId = snapshot.agentCalls.at(-1)?.sessionId;

    return Object.freeze({
      taskId: snapshot.id,
      result: cloneJsonValue(snapshot.completed.result),
      ...(sessionId ? { sessionId } : {}),
      metrics: snapshot.metrics,
    });
  }

  private nextTaskTime(task: GenerationTask, candidate: number): number {
    return Math.max(candidate, task.getSnapshot().updatedTime);
  }
}
