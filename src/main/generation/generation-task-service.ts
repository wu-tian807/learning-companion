import { randomUUID } from 'node:crypto';

import type { JsonValue } from '../../shared/workbench/protocol';
import { AppError, describeAppError } from '../errors/app-error';
import type { ProjectLookup } from '../projects/project-database';
import {
  validateGenerationAssetReferenceBindings,
  type GenerationAssetReferenceBindings,
} from './contracts/generation-asset-reference';
import type { GenerationAgentRunnerResolver } from './generation-agent-runner';
import type { GenerationTaskDatabaseApi } from './generation-task-database';
import { GenerationTaskDefinitionRegistry } from './generation-task-definition-registry';
import type {
  GenerationTaskExecution,
  GenerationTaskExecutionEvent,
  GenerationTaskExecutionResult,
} from './generation-task-execution';
import {
  GenerationTask,
  type GenerationTaskSnapshot,
} from './generation-task';

export interface CreateGenerationTaskRequest {
  readonly projectId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly instruction: JsonValue;
  readonly assetReferences: GenerationAssetReferenceBindings;
}

export type GenerationTaskEvent = GenerationTaskExecutionEvent;
export type GenerationTaskRunResult = GenerationTaskExecutionResult;

export type GenerationTaskServiceEvent =
  | {
      readonly type: 'task-changed';
      readonly snapshot: GenerationTaskSnapshot;
    }
  | {
      readonly type: 'execution-event';
      readonly projectId: string;
      readonly taskId: string;
      readonly event: GenerationTaskExecutionEvent;
    }
  | {
      readonly type: 'task-completed';
      readonly snapshot: GenerationTaskSnapshot;
      readonly result: GenerationTaskExecutionResult;
    }
  | {
      readonly type: 'task-discarded';
      readonly projectId: string;
      readonly taskId: string;
    };

export type GenerationTaskServiceListener = (
  event: GenerationTaskServiceEvent,
) => void;

export interface GenerationTaskProjectLifecycle {
  loadFromProject(projectId: string): readonly GenerationTaskSnapshot[];
  unloadProject(): void;
}

export interface GenerationTaskServiceApi
  extends GenerationTaskProjectLifecycle {
  getActiveProjectId(): string | undefined;
  list(): readonly GenerationTaskSnapshot[];
  get(taskId: string): GenerationTaskSnapshot | undefined;
  create(request: CreateGenerationTaskRequest): GenerationTaskSnapshot;
  start(request: CreateGenerationTaskRequest): GenerationTaskSnapshot;
  retry(taskId: string): GenerationTaskSnapshot;
  run(
    taskId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<GenerationTaskEvent, GenerationTaskRunResult>;
  cancel(taskId: string): void;
  discard(taskId: string): void;
  subscribe(listener: GenerationTaskServiceListener): () => void;
}

interface GenerationTaskServiceDependencies {
  readonly createId: () => string;
  readonly now: () => number;
}

const defaultDependencies: GenerationTaskServiceDependencies = {
  createId: randomUUID,
  now: Date.now,
};

function requireId(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`GenerationTaskService ${field} 不能为空`);
  }

  return normalized;
}

function createCombinedSignal(
  controller: AbortController,
  signal?: AbortSignal,
): AbortSignal {
  return signal
    ? AbortSignal.any([controller.signal, signal])
    : controller.signal;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

export class GenerationTaskService implements GenerationTaskServiceApi {
  private readonly dependencies: GenerationTaskServiceDependencies;
  private readonly tasks = new Map<string, GenerationTask>();
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly backgroundRuns = new Map<string, Promise<void>>();
  private readonly listeners = new Set<GenerationTaskServiceListener>();
  private activeProjectId: string | undefined;
  private lifecycleVersion = 0;

  constructor(
    private readonly database: GenerationTaskDatabaseApi,
    private readonly definitions: GenerationTaskDefinitionRegistry,
    private readonly execution: GenerationTaskExecution,
    private readonly projectLookup: ProjectLookup,
    private readonly runnerResolver: GenerationAgentRunnerResolver,
    dependencies: Partial<GenerationTaskServiceDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  loadFromProject(projectId: string): readonly GenerationTaskSnapshot[] {
    const normalizedProjectId = requireId(projectId, 'projectId');

    if (!this.projectLookup.get(normalizedProjectId)) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    this.lifecycleVersion += 1;
    this.abortActiveRuns();
    this.backgroundRuns.clear();
    this.tasks.clear();

    for (const snapshot of this.database.listUnfinishedByProject(
      normalizedProjectId,
    )) {
      this.tasks.set(snapshot.id, new GenerationTask(snapshot));
    }

    this.activeProjectId = normalizedProjectId;
    const snapshots = this.list();

    for (const snapshot of snapshots) {
      if (!snapshot.failure) {
        this.scheduleRun(snapshot.id);
      }
    }

    return snapshots;
  }

  unloadProject(): void {
    this.lifecycleVersion += 1;
    this.abortActiveRuns();
    this.backgroundRuns.clear();
    this.tasks.clear();
    this.activeProjectId = undefined;
  }

  getActiveProjectId(): string | undefined {
    return this.activeProjectId;
  }

  list(): readonly GenerationTaskSnapshot[] {
    this.requireActiveProjectId();
    return [...this.tasks.values()]
      .map((task) => task.getSnapshot())
      .sort(
        (left, right) =>
          left.createdTime - right.createdTime ||
          left.id.localeCompare(right.id),
      );
  }

  get(taskId: string): GenerationTaskSnapshot | undefined {
    this.requireActiveProjectId();
    const normalizedTaskId = requireId(taskId, 'taskId');
    const task = this.tasks.get(normalizedTaskId);
    if (task) {
      return task.getSnapshot();
    }

    // Completed/cancelled tasks are deliberately released from the in-memory
    // lifecycle map, but their persisted snapshot remains the authoritative
    // recovery record. Keep the project boundary explicit when reading it.
    const persisted = this.database.get(normalizedTaskId);
    return persisted?.projectId === this.activeProjectId
      ? persisted
      : undefined;
  }

  create(request: CreateGenerationTaskRequest): GenerationTaskSnapshot {
    const projectId = this.requireActiveProjectId();

    if (requireId(request.projectId, 'projectId') !== projectId) {
      throw new AppError('PROJECT_CONTEXT_CHANGED');
    }

    const definition = this.definitions.require(
      request.definitionId,
      request.definitionVersion,
    );
    const parsedInstruction = definition.instruction.parse(
      request.instruction,
    );

    if (!parsedInstruction.ok) {
      throw new AppError('DATA_INTEGRITY_ERROR', {
        cause: new Error(
          parsedInstruction.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join('\n'),
        ),
      });
    }

    const assetReferences = validateGenerationAssetReferenceBindings(
      definition.assetReferenceSchema,
      request.assetReferences,
    );
    const executionConfiguration =
      this.runnerResolver.resolveSelectorConfiguration(
        definition.providerSelectorId,
      );
    const createdTime = this.dependencies.now();
    const task = GenerationTask.create({
      id: this.dependencies.createId(),
      projectId,
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: parsedInstruction.value.toSnapshot(),
      assetReferences,
      assignedProviderId: executionConfiguration.providerId,
      assignedConnectionId: executionConfiguration.connectionId,
      ...(executionConfiguration.modelId
        ? { assignedModelId: executionConfiguration.modelId }
        : {}),
      ...(executionConfiguration.reasoningEffort
        ? {
            assignedReasoningEffort:
              executionConfiguration.reasoningEffort,
          }
        : {}),
      createdTime,
    });
    const snapshot = task.getSnapshot();
    this.database.create(snapshot);
    this.tasks.set(snapshot.id, task);
    const created = task.getSnapshot();
    this.publish({ type: 'task-changed', snapshot: created });
    return created;
  }

  start(request: CreateGenerationTaskRequest): GenerationTaskSnapshot {
    const created = this.create(request);
    this.scheduleRun(created.id);
    return created;
  }

  retry(taskId: string): GenerationTaskSnapshot {
    const snapshot = this.requireTask(taskId).getSnapshot();
    const currentRun = this.backgroundRuns.get(snapshot.id);

    if (currentRun) {
      void currentRun.finally(() => {
        if (this.tasks.has(snapshot.id)) {
          this.scheduleRun(snapshot.id);
        }
      });
    } else {
      this.scheduleRun(snapshot.id);
    }
    return snapshot;
  }

  async *run(
    taskId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<GenerationTaskEvent, GenerationTaskRunResult> {
    const task = this.requireTask(taskId);
    const initialSnapshot = task.getSnapshot();
    const lifecycleVersion = this.lifecycleVersion;

    if (initialSnapshot.cancelledTime !== undefined) {
      throw new AppError('OPERATION_SUPERSEDED');
    }

    if (this.activeRuns.has(initialSnapshot.id)) {
      throw new AppError('CODEX_TURN_ACTIVE');
    }

    const controller = new AbortController();
    const runSignal = createCombinedSignal(controller, signal);
    this.activeRuns.set(initialSnapshot.id, controller);

    try {
      const definition = this.definitions.require(
        initialSnapshot.definitionId,
        initialSnapshot.definitionVersion,
      );
      const result = yield* this.execution.run(
        task,
        definition,
        this.runnerResolver,
        runSignal,
      );
      runSignal.throwIfAborted();
      return result;
    } catch (error) {
      this.persistUnhandledRunFailure(task, error);
      throw error;
    } finally {
      if (this.activeRuns.get(initialSnapshot.id) === controller) {
        this.activeRuns.delete(initialSnapshot.id);
      }

      if (
        this.lifecycleVersion === lifecycleVersion &&
        this.tasks.get(initialSnapshot.id) === task &&
        task.getStatus() === 'completed'
      ) {
        this.releaseCompletedTask(initialSnapshot.id);
      }
    }
  }

  cancel(taskId: string): void {
    const task = this.requireTask(taskId);
    const id = task.getSnapshot().id;
    this.activeRuns.get(id)?.abort();
    task.cancel(
      Math.max(this.dependencies.now(), task.getSnapshot().updatedTime),
    );
    this.database.update(task.getSnapshot());
    this.publish({
      type: 'task-changed',
      snapshot: task.getSnapshot(),
    });
    this.tasks.delete(id);
  }

  discard(taskId: string): void {
    const task = this.requireTask(taskId);
    const snapshot = task.getSnapshot();
    const id = snapshot.id;
    this.activeRuns.get(id)?.abort();
    this.database.delete(id);
    this.tasks.delete(id);
    this.publish({
      type: 'task-discarded',
      projectId: snapshot.projectId,
      taskId: id,
    });
  }

  subscribe(listener: GenerationTaskServiceListener): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private releaseCompletedTask(taskId: string): void {
    this.tasks.delete(taskId);
  }

  private persistUnhandledRunFailure(
    task: GenerationTask,
    error: unknown,
  ): void {
    const snapshot = task.getSnapshot();
    if (
      isAbortError(error) ||
      snapshot.failure ||
      snapshot.completed ||
      snapshot.cancelledTime !== undefined
    ) {
      return;
    }

    const description = describeAppError(error);
    task.recordFailure({
      phase: snapshot.prepared ? 'process' : 'prepare',
      failedTime: Math.max(
        this.dependencies.now(),
        snapshot.updatedTime,
      ),
      message: description.userMessage ?? 'GenerationTask 执行失败',
      code: description.code,
      ...(description.detail ? { detail: description.detail } : {}),
    });
    this.database.update(task.getSnapshot());
  }

  private requireTask(taskId: string): GenerationTask {
    this.requireActiveProjectId();
    const task = this.tasks.get(requireId(taskId, 'taskId'));

    if (!task) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return task;
  }

  private requireActiveProjectId(): string {
    if (!this.activeProjectId) {
      throw new AppError('SERVICE_NOT_READY');
    }

    return this.activeProjectId;
  }

  private abortActiveRuns(): void {
    for (const controller of this.activeRuns.values()) {
      controller.abort();
    }

    this.activeRuns.clear();
  }

  private scheduleRun(taskId: string): void {
    if (this.backgroundRuns.has(taskId)) {
      return;
    }

    const run = this.drainRun(taskId).finally(() => {
      if (this.backgroundRuns.get(taskId) === run) {
        this.backgroundRuns.delete(taskId);
      }
    });
    this.backgroundRuns.set(taskId, run);
  }

  private async drainRun(taskId: string): Promise<void> {
    const initial = this.requireTask(taskId).getSnapshot();
    const lifecycleVersion = this.lifecycleVersion;

    try {
      const iterator = this.run(taskId);
      let next = await iterator.next();

      while (!next.done) {
        if (
          this.activeProjectId !== initial.projectId ||
          this.lifecycleVersion !== lifecycleVersion
        ) {
          return;
        }

        this.publish({
          type: 'execution-event',
          projectId: initial.projectId,
          taskId,
          event: next.value,
        });
        const current = this.tasks.get(taskId)?.getSnapshot();
        if (current) {
          this.publish({ type: 'task-changed', snapshot: current });
        }
        next = await iterator.next();
      }

      if (
        this.activeProjectId !== initial.projectId ||
        this.lifecycleVersion !== lifecycleVersion
      ) {
        return;
      }

      const completed = this.database.get(taskId);
      if (completed) {
        this.publish({
          type: 'task-completed',
          snapshot: completed,
          result: next.value,
        });
      }
    } catch (error) {
      if (
        this.activeProjectId !== initial.projectId ||
        this.lifecycleVersion !== lifecycleVersion
      ) {
        return;
      }

      const failed = this.tasks.get(taskId)?.getSnapshot();
      if (failed) {
        this.publish({ type: 'task-changed', snapshot: failed });
      }
      if (isAbortError(error) || !failed) {
        return;
      }
      console.error('GenerationTask 后台执行失败', {
        taskId,
        error,
      });
    }
  }

  private publish(event: GenerationTaskServiceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('发布 GenerationTask 事件失败', error);
      }
    }
  }
}
