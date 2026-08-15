import { and, asc, eq, isNull } from 'drizzle-orm';

import type { DatabaseContext } from '../database/database-context';
import { generationTasks } from '../database/schema/generation-tasks';
import { AppError } from '../errors/app-error';
import {
  cloneGenerationTaskMetrics,
  type GenerationTaskMetrics,
} from './contracts/generation-metrics';
import {
  cloneGenerationTaskSnapshot,
  type GenerationTaskAgentCallCheckpoint,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalizes the one-turn metrics written before database version 16. */
function normalizePersistedMetrics(
  value: unknown,
  agentCalls: readonly GenerationTaskAgentCallCheckpoint[],
  processCompleted: boolean,
  assignedConnectionId: string | null,
): GenerationTaskMetrics {
  if (!isRecord(value) || !Array.isArray(value.agentExecutions)) {
    throw new Error('GenerationTask metrics JSON 数据无效');
  }

  const executions: Array<
    Record<string, unknown> & { callKey: string; purpose: string }
  > = value.agentExecutions.map((execution, index) => {
    if (!isRecord(execution)) {
      throw new Error('GenerationTask Agent metrics JSON 数据无效');
    }

    const checkpoint = agentCalls[index];
    return {
      ...execution,
      connectionId:
        typeof execution.connectionId === 'string'
          ? execution.connectionId
          : assignedConnectionId ?? 'legacy-account',
      callKey:
        typeof execution.callKey === 'string'
          ? execution.callKey
          : checkpoint?.callKey ?? `legacy-call-${index + 1}`,
      purpose:
        typeof execution.purpose === 'string'
          ? execution.purpose
          : checkpoint?.purpose ?? 'generation',
    };
  });
  const agentDuration = executions.reduce((total, execution) => {
    const duration = execution['activeDurationMs'];
    return total + (typeof duration === 'number' ? duration : 0);
  }, 0);
  const prepareDurationMs =
    typeof value.prepareDurationMs === 'number'
      ? value.prepareDurationMs
      : undefined;
  const processDurationMs = processCompleted
    ? typeof value.processDurationMs === 'number'
      ? value.processDurationMs
      : agentDuration
    : undefined;

  return cloneGenerationTaskMetrics({
    ...(prepareDurationMs === undefined ? {} : { prepareDurationMs }),
    agentExecutions:
      executions as unknown as GenerationTaskMetrics['agentExecutions'],
    ...(processDurationMs === undefined ? {} : { processDurationMs }),
    totalActiveDurationMs:
      (prepareDurationMs ?? 0) +
      (processDurationMs ?? agentDuration),
    ...(value.totalUsage === undefined
      ? {}
      : {
          totalUsage:
            value.totalUsage as GenerationTaskMetrics['totalUsage'],
        }),
  });
}

function mapRow(
  row: typeof generationTasks.$inferSelect,
): GenerationTaskSnapshot {
  try {
    const agentCalls = row.agentCalls;
    const processCompleted = row.processCompletedTime !== null;

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
              ...row.preparedData!,
            },
          }),
      ...(row.assignedProviderId === null
        ? {}
        : { assignedProviderId: row.assignedProviderId }),
      ...(row.assignedConnectionId === null
        ? {}
        : { assignedConnectionId: row.assignedConnectionId }),
      ...(row.assignedModelId === null
        ? {}
        : { assignedModelId: row.assignedModelId }),
      ...(row.assignedReasoningEffort === null
        ? {}
        : { assignedReasoningEffort: row.assignedReasoningEffort }),
      agentCalls,
      ...(processCompleted
        ? {
            completed: {
              completedTime: row.processCompletedTime!,
              result: row.processResult!,
            },
          }
        : {}),
      metrics: normalizePersistedMetrics(
        row.metrics,
        agentCalls,
        processCompleted,
        row.assignedConnectionId,
      ),
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
    preparedData:
      snapshot.prepared === undefined
        ? null
        : { assetReferences: snapshot.prepared.assetReferences },
    assignedProviderId: snapshot.assignedProviderId ?? null,
    assignedConnectionId: snapshot.assignedConnectionId ?? null,
    assignedModelId: snapshot.assignedModelId ?? null,
    assignedReasoningEffort: snapshot.assignedReasoningEffort ?? null,
    agentCalls: snapshot.agentCalls,
    processCompletedTime: snapshot.completed?.completedTime ?? null,
    processResult: snapshot.completed?.result ?? null,
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
          isNull(generationTasks.processCompletedTime),
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
        preparedData: row.preparedData,
        assignedProviderId: row.assignedProviderId,
        assignedConnectionId: row.assignedConnectionId,
        assignedModelId: row.assignedModelId,
        assignedReasoningEffort: row.assignedReasoningEffort,
        agentCalls: row.agentCalls,
        processCompletedTime: row.processCompletedTime,
        processResult: row.processResult,
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
