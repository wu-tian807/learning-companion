import { and, asc, eq, isNull } from 'drizzle-orm';

import type { DatabaseContext } from '../database/database-context';
import { generationTasks } from '../database/schema/generation-tasks';
import { AppError } from '../errors/app-error';
import {
  cloneGenerationTaskSnapshot,
  type GenerationTaskSnapshot,
} from './generation-task';

export interface GenerationTaskDatabaseApi {
  get(taskId: string): GenerationTaskSnapshot | undefined;
  listByProject(projectId: string): readonly GenerationTaskSnapshot[];
  listUnfinishedByProject(
    projectId: string,
  ): readonly GenerationTaskSnapshot[];
  create(task: GenerationTaskSnapshot): void;
  update(task: GenerationTaskSnapshot): void;
  delete(taskId: string): void;
}

function requireId(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new AppError('DATA_INTEGRITY_ERROR', {
      cause: new Error(`GenerationTask ${field} 不能为空`),
    });
  }

  return normalized;
}

function mapRow(
  row: typeof generationTasks.$inferSelect,
): GenerationTaskSnapshot {
  try {
    return cloneGenerationTaskSnapshot({
      id: row.id,
      projectId: row.projectId,
      definitionId: row.definitionId,
      definitionVersion: row.definitionVersion,
      instruction: row.instruction,
      assetReferences: row.assetReferences,
      ...(row.preparedTime === null
        ? {}
        : {
            prepared: {
              completedTime: row.preparedTime,
              manifestRef: row.preparedManifestRef!,
            },
          }),
      ...(row.assignedProviderId === null
        ? {}
        : { assignedProviderId: row.assignedProviderId }),
      ...(row.agentCompletedTime === null
        ? {}
        : {
            agentCompleted: {
              completedTime: row.agentCompletedTime,
              sessionId: row.agentSessionId!,
              ...(row.agentProviderExecutionId === null
                ? {}
                : {
                    providerExecutionId:
                      row.agentProviderExecutionId,
                  }),
            },
          }),
      ...(row.postProcessedTime === null
        ? {}
        : {
            postProcessed: {
              completedTime: row.postProcessedTime,
              result: row.postProcessResult!,
            },
          }),
      metrics: row.metrics,
      ...(row.failure === null ? {} : { failure: row.failure }),
      ...(row.cancelledTime === null
        ? {}
        : { cancelledTime: row.cancelledTime }),
      createdTime: row.createdTime,
      updatedTime: row.updatedTime,
    });
  } catch (error) {
    throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
  }
}

function toRow(task: GenerationTaskSnapshot) {
  const snapshot = cloneGenerationTaskSnapshot(task);

  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    definitionId: snapshot.definitionId,
    definitionVersion: snapshot.definitionVersion,
    instruction: snapshot.instruction,
    assetReferences: snapshot.assetReferences,
    preparedTime: snapshot.prepared?.completedTime ?? null,
    preparedManifestRef: snapshot.prepared?.manifestRef ?? null,
    assignedProviderId: snapshot.assignedProviderId ?? null,
    agentCompletedTime: snapshot.agentCompleted?.completedTime ?? null,
    agentSessionId: snapshot.agentCompleted?.sessionId ?? null,
    agentProviderExecutionId:
      snapshot.agentCompleted?.providerExecutionId ?? null,
    postProcessedTime: snapshot.postProcessed?.completedTime ?? null,
    postProcessResult: snapshot.postProcessed?.result ?? null,
    metrics: snapshot.metrics,
    failure: snapshot.failure ?? null,
    cancelledTime: snapshot.cancelledTime ?? null,
    createdTime: snapshot.createdTime,
    updatedTime: snapshot.updatedTime,
  };
}

export class GenerationTaskDatabase
  implements GenerationTaskDatabaseApi
{
  constructor(private readonly context: DatabaseContext) {}

  get(taskId: string): GenerationTaskSnapshot | undefined {
    const row = this.context.db
      .select()
      .from(generationTasks)
      .where(eq(generationTasks.id, requireId(taskId, 'taskId')))
      .get();

    return row ? mapRow(row) : undefined;
  }

  listByProject(projectId: string): readonly GenerationTaskSnapshot[] {
    return this.context.db
      .select()
      .from(generationTasks)
      .where(
        eq(generationTasks.projectId, requireId(projectId, 'projectId')),
      )
      .orderBy(asc(generationTasks.createdTime), asc(generationTasks.id))
      .all()
      .map(mapRow);
  }

  listUnfinishedByProject(
    projectId: string,
  ): readonly GenerationTaskSnapshot[] {
    return this.context.db
      .select()
      .from(generationTasks)
      .where(
        and(
          eq(
            generationTasks.projectId,
            requireId(projectId, 'projectId'),
          ),
          isNull(generationTasks.postProcessedTime),
          isNull(generationTasks.cancelledTime),
        ),
      )
      .orderBy(asc(generationTasks.createdTime), asc(generationTasks.id))
      .all()
      .map(mapRow);
  }

  create(task: GenerationTaskSnapshot): void {
    const result = this.context.db
      .insert(generationTasks)
      .values(toRow(task))
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
  }

  update(task: GenerationTaskSnapshot): void {
    const row = toRow(task);
    const result = this.context.db
      .update(generationTasks)
      .set({
        definitionId: row.definitionId,
        definitionVersion: row.definitionVersion,
        instruction: row.instruction,
        assetReferences: row.assetReferences,
        preparedTime: row.preparedTime,
        preparedManifestRef: row.preparedManifestRef,
        assignedProviderId: row.assignedProviderId,
        agentCompletedTime: row.agentCompletedTime,
        agentSessionId: row.agentSessionId,
        agentProviderExecutionId: row.agentProviderExecutionId,
        postProcessedTime: row.postProcessedTime,
        postProcessResult: row.postProcessResult,
        metrics: row.metrics,
        failure: row.failure,
        cancelledTime: row.cancelledTime,
        updatedTime: row.updatedTime,
      })
      .where(eq(generationTasks.id, row.id))
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
  }

  delete(taskId: string): void {
    this.context.db
      .delete(generationTasks)
      .where(eq(generationTasks.id, requireId(taskId, 'taskId')))
      .run();
  }
}
