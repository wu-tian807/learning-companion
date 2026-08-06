import { randomUUID } from 'node:crypto';

import type { JsonValue } from '../../shared/workbench/protocol';
import { AppError } from '../errors/app-error';
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

export interface GenerationTaskServiceApi {
  loadFromProject(projectId: string): readonly GenerationTaskSnapshot[];
  unloadProject(): void;
  getActiveProjectId(): string | undefined;
  list(): readonly GenerationTaskSnapshot[];
  get(taskId: string): GenerationTaskSnapshot | undefined;
  create(request: CreateGenerationTaskRequest): GenerationTaskSnapshot;
  run(
    taskId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<GenerationTaskEvent, GenerationTaskRunResult>;
  cancel(taskId: string): void;
  discard(taskId: string): void;
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

export class GenerationTaskService implements GenerationTaskServiceApi {
  private readonly dependencies: GenerationTaskServiceDependencies;
  private readonly tasks = new Map<string, GenerationTask>();
  private readonly activeRuns = new Map<string, AbortController>();
  private activeProjectId: string | undefined;

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

    this.abortActiveRuns();
    this.tasks.clear();

    for (const snapshot of this.database.listUnfinishedByProject(
      normalizedProjectId,
    )) {
      this.tasks.set(snapshot.id, new GenerationTask(snapshot));
    }

    this.activeProjectId = normalizedProjectId;
    return this.list();
  }

  unloadProject(): void {
    this.abortActiveRuns();
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
    return this.tasks.get(requireId(taskId, 'taskId'))?.getSnapshot();
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
    const createdTime = this.dependencies.now();
    const task = GenerationTask.create({
      id: this.dependencies.createId(),
      projectId,
      definitionId: definition.id,
      definitionVersion: definition.version,
      instruction: parsedInstruction.value.toSnapshot(),
      assetReferences,
      createdTime,
    });
    const snapshot = task.getSnapshot();
    this.database.create(snapshot);
    this.tasks.set(snapshot.id, task);
    return task.getSnapshot();
  }

  async *run(
    taskId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<GenerationTaskEvent, GenerationTaskRunResult> {
    const task = this.requireTask(taskId);
    const initialSnapshot = task.getSnapshot();

    if (initialSnapshot.cancelledTime !== undefined) {
      throw new AppError('OPERATION_SUPERSEDED');
    }

    if (this.activeRuns.has(initialSnapshot.id)) {
      throw new AppError('CODEX_TURN_ACTIVE');
    }

    const definition = this.definitions.require(
      initialSnapshot.definitionId,
      initialSnapshot.definitionVersion,
    );
    const controller = new AbortController();
    const runSignal = createCombinedSignal(controller, signal);
    this.activeRuns.set(initialSnapshot.id, controller);

    try {
      const result = yield* this.execution.run(
        task,
        definition,
        this.runnerResolver,
        runSignal,
      );
      runSignal.throwIfAborted();
      return result;
    } finally {
      this.activeRuns.delete(initialSnapshot.id);

      if (task.getStatus() === 'post-processed') {
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
    this.tasks.delete(id);
  }

  discard(taskId: string): void {
    const task = this.requireTask(taskId);
    const id = task.getSnapshot().id;
    this.activeRuns.get(id)?.abort();
    this.database.delete(id);
    this.tasks.delete(id);
  }

  private releaseCompletedTask(taskId: string): void {
    this.tasks.delete(taskId);
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
}
