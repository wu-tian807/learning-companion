import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from '../../../shared/workbench/protocol';
import {
  cloneGenerationAssetReferenceBindings,
  type GenerationAssetReferenceBindings,
} from './generation-asset-reference';
import {
  cloneGenerationTaskMetrics,
  type GenerationTaskMetrics,
} from './generation-metrics';

export interface GenerationTaskPreparedCheckpoint {
  readonly completedTime: number;
  readonly manifestRef: string;
}

export interface GenerationTaskAgentCheckpoint {
  readonly completedTime: number;
  readonly sessionId: string;
  readonly outputRef: string;
  readonly providerExecutionId?: string;
}

export interface GenerationTaskPostProcessCheckpoint {
  readonly completedTime: number;
  readonly result: JsonValue;
}

export type GenerationTaskFailurePhase =
  | 'prepare'
  | 'agent'
  | 'post-process';

export interface GenerationTaskFailure {
  readonly phase: GenerationTaskFailurePhase;
  readonly failedTime: number;
  readonly message: string;
  readonly code?: string;
}

export interface GenerationTaskSnapshot {
  readonly id: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly instruction: JsonValue;
  readonly assetReferences: GenerationAssetReferenceBindings;
  readonly prepared?: GenerationTaskPreparedCheckpoint;
  readonly agentCompleted?: GenerationTaskAgentCheckpoint;
  readonly postProcessed?: GenerationTaskPostProcessCheckpoint;
  readonly metrics: GenerationTaskMetrics;
  readonly failure?: GenerationTaskFailure;
  readonly cancelledTime?: number;
  readonly createdTime: number;
  readonly updatedTime: number;
}

export type GenerationTaskStatus =
  | 'created'
  | 'prepared'
  | 'agent-completed'
  | 'post-processed'
  | 'failed'
  | 'cancelled';

export interface CreateGenerationTaskInput {
  readonly id: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly instruction: JsonValue;
  readonly assetReferences: GenerationAssetReferenceBindings;
  readonly createdTime: number;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`GenerationTask ${field} 不能为空`);
  }

  return normalized;
}

function requireTime(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`GenerationTask ${field} 数据无效`);
  }

  return value;
}

function requireRelativePath(value: string, field: string): string {
  const normalized = requireText(value, field);

  if (
    normalized.includes('\\') ||
    normalized.startsWith('/') ||
    normalized
      .split('/')
      .some(
        (segment) =>
          segment.length === 0 || segment === '.' || segment === '..',
      )
  ) {
    throw new Error(`GenerationTask ${field} 必须是可移植相对路径`);
  }

  return normalized;
}

function clonePreparedCheckpoint(
  checkpoint: GenerationTaskPreparedCheckpoint,
): GenerationTaskPreparedCheckpoint {
  return Object.freeze({
    completedTime: requireTime(
      checkpoint.completedTime,
      'prepared.completedTime',
    ),
    manifestRef: requireRelativePath(
      checkpoint.manifestRef,
      'prepared.manifestRef',
    ),
  });
}

function cloneAgentCheckpoint(
  checkpoint: GenerationTaskAgentCheckpoint,
): GenerationTaskAgentCheckpoint {
  return Object.freeze({
    completedTime: requireTime(
      checkpoint.completedTime,
      'agentCompleted.completedTime',
    ),
    sessionId: requireText(
      checkpoint.sessionId,
      'agentCompleted.sessionId',
    ),
    outputRef: requireRelativePath(
      checkpoint.outputRef,
      'agentCompleted.outputRef',
    ),
    ...(checkpoint.providerExecutionId === undefined
      ? {}
      : {
          providerExecutionId: requireText(
            checkpoint.providerExecutionId,
            'agentCompleted.providerExecutionId',
          ),
        }),
  });
}

function clonePostProcessCheckpoint(
  checkpoint: GenerationTaskPostProcessCheckpoint,
): GenerationTaskPostProcessCheckpoint {
  return Object.freeze({
    completedTime: requireTime(
      checkpoint.completedTime,
      'postProcessed.completedTime',
    ),
    result: cloneJsonValue(checkpoint.result),
  });
}

function cloneFailure(
  failure: GenerationTaskFailure,
): GenerationTaskFailure {
  if (
    failure.phase !== 'prepare' &&
    failure.phase !== 'agent' &&
    failure.phase !== 'post-process'
  ) {
    throw new Error('GenerationTask failure.phase 数据无效');
  }

  return Object.freeze({
    phase: failure.phase,
    failedTime: requireTime(failure.failedTime, 'failure.failedTime'),
    message: requireText(failure.message, 'failure.message'),
    ...(failure.code === undefined
      ? {}
      : { code: requireText(failure.code, 'failure.code') }),
  });
}

export function cloneGenerationTaskSnapshot(
  snapshot: GenerationTaskSnapshot,
): GenerationTaskSnapshot {
  if (
    !Number.isSafeInteger(snapshot.definitionVersion) ||
    snapshot.definitionVersion <= 0 ||
    !isJsonValue(snapshot.instruction)
  ) {
    throw new Error('GenerationTask definition 或 instruction 数据无效');
  }

  const prepared = snapshot.prepared
    ? clonePreparedCheckpoint(snapshot.prepared)
    : undefined;
  const agentCompleted = snapshot.agentCompleted
    ? cloneAgentCheckpoint(snapshot.agentCompleted)
    : undefined;
  const postProcessed = snapshot.postProcessed
    ? clonePostProcessCheckpoint(snapshot.postProcessed)
    : undefined;
  const metrics = cloneGenerationTaskMetrics(snapshot.metrics);
  const createdTime = requireTime(snapshot.createdTime, 'createdTime');
  const updatedTime = requireTime(snapshot.updatedTime, 'updatedTime');
  const cancelledTime =
    snapshot.cancelledTime === undefined
      ? undefined
      : requireTime(snapshot.cancelledTime, 'cancelledTime');
  const failure = snapshot.failure
    ? cloneFailure(snapshot.failure)
    : undefined;

  if (
    updatedTime < createdTime ||
    (prepared && prepared.completedTime < createdTime) ||
    (agentCompleted &&
      (!prepared || agentCompleted.completedTime < prepared.completedTime)) ||
    (postProcessed &&
      (!agentCompleted ||
        postProcessed.completedTime < agentCompleted.completedTime)) ||
    (cancelledTime !== undefined &&
      (cancelledTime < createdTime || postProcessed !== undefined)) ||
    (failure &&
      (failure.failedTime < createdTime || postProcessed !== undefined)) ||
    (prepared && prepared.completedTime > updatedTime) ||
    (agentCompleted && agentCompleted.completedTime > updatedTime) ||
    (postProcessed && postProcessed.completedTime > updatedTime) ||
    (cancelledTime !== undefined && cancelledTime > updatedTime) ||
    (failure && failure.failedTime > updatedTime) ||
    (prepared === undefined) !== (metrics.prepareDurationMs === undefined) ||
    (agentCompleted === undefined) !==
      (metrics.agentExecutions.length === 0) ||
    (postProcessed === undefined) !==
      (metrics.postProcessDurationMs === undefined)
  ) {
    throw new Error('GenerationTask checkpoint 顺序或 metrics 数据无效');
  }

  if (
    agentCompleted &&
    metrics.agentExecutions.at(-1)?.sessionId !== agentCompleted.sessionId
  ) {
    throw new Error('GenerationTask session metrics 数据不一致');
  }

  return Object.freeze({
    id: requireText(snapshot.id, 'id'),
    projectId: requireText(snapshot.projectId, 'projectId'),
    definitionId: requireText(snapshot.definitionId, 'definitionId'),
    definitionVersion: snapshot.definitionVersion,
    instruction: cloneJsonValue(snapshot.instruction),
    assetReferences: cloneGenerationAssetReferenceBindings(
      snapshot.assetReferences,
    ),
    ...(prepared ? { prepared } : {}),
    ...(agentCompleted ? { agentCompleted } : {}),
    ...(postProcessed ? { postProcessed } : {}),
    metrics,
    ...(failure ? { failure } : {}),
    ...(cancelledTime === undefined ? {} : { cancelledTime }),
    createdTime,
    updatedTime,
  });
}
