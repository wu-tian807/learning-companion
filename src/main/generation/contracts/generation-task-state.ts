import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from '../../../shared/workbench/protocol';
import {
  isAgentProviderConnectionId,
  isAgentProviderId,
} from '../../../shared/agent-providers';
import {
  cloneGenerationAssetReferenceBindings,
  clonePreparedGenerationAssetReferenceBindings,
  type GenerationAssetReferenceBindings,
  type PreparedGenerationAssetReferenceBindings,
} from './generation-asset-reference';
import {
  cloneGenerationTaskMetrics,
  type GenerationTaskMetrics,
} from './generation-metrics';

export interface GenerationTaskPreparedData {
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
}

export type GenerationTaskPreparedCheckpoint = Readonly<
  { readonly completedTime: number } & GenerationTaskPreparedData
>;

export interface GenerationTaskAgentCallCheckpoint {
  readonly callKey: string;
  readonly purpose: string;
  readonly sessionKey?: string;
  readonly completedTime: number;
  readonly sessionId: string;
  readonly providerExecutionId?: string;
  readonly assistantOutput?: string;
}

export interface GenerationTaskCompletedCheckpoint {
  readonly completedTime: number;
  readonly result: JsonValue;
}

export type GenerationTaskFailurePhase = 'prepare' | 'process';

export interface GenerationTaskFailure {
  readonly phase: GenerationTaskFailurePhase;
  readonly failedTime: number;
  readonly message: string;
  readonly code?: string;
  readonly detail?: string;
}

export interface GenerationTaskSnapshot {
  readonly id: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly instruction: JsonValue;
  readonly assetReferences: GenerationAssetReferenceBindings;
  readonly prepared?: GenerationTaskPreparedCheckpoint;
  readonly assignedProviderId?: string;
  readonly assignedConnectionId?: string;
  readonly assignedModelId?: string;
  readonly assignedReasoningEffort?: string;
  readonly agentCalls: readonly GenerationTaskAgentCallCheckpoint[];
  readonly completed?: GenerationTaskCompletedCheckpoint;
  readonly metrics: GenerationTaskMetrics;
  readonly failure?: GenerationTaskFailure;
  readonly cancelledTime?: number;
  readonly createdTime: number;
  readonly updatedTime: number;
}

export type GenerationTaskStatus =
  | 'created'
  | 'prepared'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CreateGenerationTaskInput {
  readonly id: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly instruction: JsonValue;
  readonly assetReferences: GenerationAssetReferenceBindings;
  readonly assignedProviderId?: string;
  readonly assignedConnectionId?: string;
  readonly assignedModelId?: string;
  readonly assignedReasoningEffort?: string;
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

function requireAssistantOutput(value: string, field: string): string {
  if (typeof value !== 'string' || value.length > 4 * 1024 * 1024) {
    throw new Error(`GenerationTask ${field} 数据无效`);
  }
  return value;
}

function clonePreparedCheckpoint(
  checkpoint: GenerationTaskPreparedCheckpoint,
): GenerationTaskPreparedCheckpoint {
  const completedTime = requireTime(
    checkpoint.completedTime,
    'prepared.completedTime',
  );

  return Object.freeze({
    completedTime,
    assetReferences: clonePreparedGenerationAssetReferenceBindings(
      checkpoint.assetReferences,
    ),
  });
}

function cloneAgentCallCheckpoint(
  checkpoint: GenerationTaskAgentCallCheckpoint,
  index: number,
): GenerationTaskAgentCallCheckpoint {
  return Object.freeze({
    callKey: requireText(checkpoint.callKey, `agentCalls[${index}].callKey`),
    purpose: requireText(checkpoint.purpose, `agentCalls[${index}].purpose`),
    ...(checkpoint.sessionKey === undefined
      ? {}
      : {
          sessionKey: requireText(
            checkpoint.sessionKey,
            `agentCalls[${index}].sessionKey`,
          ),
        }),
    completedTime: requireTime(
      checkpoint.completedTime,
      `agentCalls[${index}].completedTime`,
    ),
    sessionId: requireText(
      checkpoint.sessionId,
      `agentCalls[${index}].sessionId`,
    ),
    ...(checkpoint.assistantOutput === undefined
      ? {}
      : {
          assistantOutput: requireAssistantOutput(
            checkpoint.assistantOutput,
            `agentCalls[${index}].assistantOutput`,
          ),
        }),
    ...(checkpoint.providerExecutionId === undefined
      ? {}
      : {
          providerExecutionId: requireText(
            checkpoint.providerExecutionId,
            `agentCalls[${index}].providerExecutionId`,
          ),
        }),
  });
}

function cloneCompletedCheckpoint(
  checkpoint: GenerationTaskCompletedCheckpoint,
): GenerationTaskCompletedCheckpoint {
  if (!isJsonValue(checkpoint.result)) {
    throw new Error('GenerationTask completed.result 数据无效');
  }

  return Object.freeze({
    completedTime: requireTime(
      checkpoint.completedTime,
      'completed.completedTime',
    ),
    result: cloneJsonValue(checkpoint.result),
  });
}

function cloneFailure(
  failure: GenerationTaskFailure,
): GenerationTaskFailure {
  if (failure.phase !== 'prepare' && failure.phase !== 'process') {
    throw new Error('GenerationTask failure.phase 数据无效');
  }

  return Object.freeze({
    phase: failure.phase,
    failedTime: requireTime(failure.failedTime, 'failure.failedTime'),
    message: requireText(failure.message, 'failure.message'),
    ...(failure.code === undefined
      ? {}
      : { code: requireText(failure.code, 'failure.code') }),
    ...(failure.detail === undefined
      ? {}
      : { detail: requireText(failure.detail, 'failure.detail') }),
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
  const assignedProviderId = snapshot.assignedProviderId;
  const assignedConnectionId = snapshot.assignedConnectionId;
  const assignedModelId = snapshot.assignedModelId;
  const assignedReasoningEffort = snapshot.assignedReasoningEffort;
  const agentCalls = Object.freeze(
    snapshot.agentCalls.map(cloneAgentCallCheckpoint),
  );
  const completed = snapshot.completed
    ? cloneCompletedCheckpoint(snapshot.completed)
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
  const callKeys = agentCalls.map(({ callKey }) => callKey);
  const lastCallTime = agentCalls.at(-1)?.completedTime;
  const sessionIdsByKey = new Map<string | undefined, string>();
  const hasInvalidSessionGroup = agentCalls.some((call) => {
    const sessionId = sessionIdsByKey.get(call.sessionKey);
    if (sessionId !== undefined) return sessionId !== call.sessionId;
    sessionIdsByKey.set(call.sessionKey, call.sessionId);
    return false;
  });

  if (
    updatedTime < createdTime ||
    (prepared && prepared.completedTime < createdTime) ||
    (prepared && prepared.completedTime > updatedTime) ||
    (assignedProviderId !== undefined &&
      !isAgentProviderId(assignedProviderId)) ||
    (assignedConnectionId !== undefined &&
      (assignedProviderId === undefined ||
        !isAgentProviderConnectionId(assignedConnectionId))) ||
    (assignedProviderId !== undefined && assignedConnectionId === undefined) ||
    (assignedModelId !== undefined &&
      (assignedProviderId === undefined ||
        requireText(assignedModelId, 'assignedModelId') !== assignedModelId)) ||
    (assignedReasoningEffort !== undefined &&
      (assignedProviderId === undefined ||
        requireText(
          assignedReasoningEffort,
          'assignedReasoningEffort',
        ) !== assignedReasoningEffort)) ||
    (agentCalls.length > 0 && assignedConnectionId === undefined) ||
    new Set(callKeys).size !== callKeys.length ||
    hasInvalidSessionGroup ||
    agentCalls.some(
      (call, index) =>
        !prepared ||
        call.completedTime < prepared.completedTime ||
        call.completedTime > updatedTime ||
        (index > 0 &&
          call.completedTime < agentCalls[index - 1]!.completedTime),
    ) ||
    (completed &&
      (!prepared ||
        completed.completedTime < (lastCallTime ?? prepared.completedTime) ||
        completed.completedTime > updatedTime)) ||
    (cancelledTime !== undefined &&
      (cancelledTime < createdTime ||
        cancelledTime > updatedTime ||
        completed !== undefined)) ||
    (failure &&
      (failure.failedTime < createdTime ||
        failure.failedTime > updatedTime ||
        completed !== undefined)) ||
    (prepared === undefined) !== (metrics.prepareDurationMs === undefined) ||
    agentCalls.length !== metrics.agentExecutions.length ||
    (completed === undefined) !== (metrics.processDurationMs === undefined)
  ) {
    throw new Error('GenerationTask checkpoint 顺序或 metrics 数据无效');
  }

  for (let index = 0; index < agentCalls.length; index += 1) {
    const call = agentCalls[index]!;
    const execution = metrics.agentExecutions[index]!;

    if (
      call.callKey !== execution.callKey ||
      call.purpose !== execution.purpose ||
      call.sessionId !== execution.sessionId ||
      execution.providerId !== assignedProviderId ||
      execution.connectionId !== assignedConnectionId
    ) {
      throw new Error('GenerationTask Agent call 与 metrics 数据不一致');
    }
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
    ...(assignedProviderId === undefined ? {} : { assignedProviderId }),
    ...(assignedConnectionId === undefined ? {} : { assignedConnectionId }),
    ...(assignedModelId === undefined ? {} : { assignedModelId }),
    ...(assignedReasoningEffort === undefined
      ? {}
      : { assignedReasoningEffort }),
    agentCalls,
    ...(completed ? { completed } : {}),
    metrics,
    ...(failure ? { failure } : {}),
    ...(cancelledTime === undefined ? {} : { cancelledTime }),
    createdTime,
    updatedTime,
  });
}
