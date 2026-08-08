import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from './workbench/protocol';

export type GenerationTaskStatus =
  | 'created'
  | 'prepared'
  | 'agent-assigned'
  | 'agent-completed'
  | 'post-processed'
  | 'failed'
  | 'cancelled';

export type GenerationTaskFailurePhase =
  | 'prepare'
  | 'agent'
  | 'post-process';

export interface GenerationTaskFailureView {
  readonly phase: GenerationTaskFailurePhase;
  readonly failedTime: number;
  readonly message: string;
  readonly code?: string;
  readonly detail?: string;
}

export interface GenerationTaskView {
  readonly id: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly status: GenerationTaskStatus;
  readonly assignedProviderId?: string;
  readonly sessionId?: string;
  readonly result?: JsonValue;
  readonly metrics: JsonValue;
  readonly failure?: GenerationTaskFailureView;
  readonly createdTime: number;
  readonly updatedTime: number;
}

export interface GenerationAssetReferenceInput {
  readonly assetId: string;
}

export type GenerationAssetReferenceBindings = Readonly<
  Record<string, readonly GenerationAssetReferenceInput[]>
>;

export interface StartGenerationTaskRequest {
  readonly projectId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly instruction: JsonValue;
  readonly assetReferences: GenerationAssetReferenceBindings;
}

export interface GenerationTaskProjectRequest {
  readonly projectId: string;
}

export interface GenerationTaskIdRequest {
  readonly projectId: string;
  readonly taskId: string;
}

export type GenerationExecutionEvent =
  | {
      readonly type: 'phase';
      readonly phase: GenerationTaskFailurePhase;
      readonly state: 'started' | 'completed';
    }
  | {
      readonly type: 'session-resolved';
      readonly sessionId: string;
    }
  | {
      readonly type: 'assistant-delta';
      readonly delta: string;
    }
  | {
      readonly type: 'tool-call';
      readonly phase: 'started' | 'completed';
      readonly callId: string;
      readonly toolName: string;
      readonly payload?: JsonValue;
    }
  | {
      readonly type: 'status';
      readonly message: string;
    }
  | {
      readonly type: 'output-rejected';
      readonly repairTurnNumber: number;
      readonly issues: readonly {
        readonly path: string;
        readonly message: string;
      }[];
    };

export type GenerationTaskEvent =
  | {
      readonly type: 'task-changed';
      readonly snapshot: GenerationTaskView;
    }
  | {
      readonly type: 'execution-event';
      readonly projectId: string;
      readonly taskId: string;
      readonly event: GenerationExecutionEvent;
    }
  | {
      readonly type: 'task-completed';
      readonly snapshot: GenerationTaskView;
    }
  | {
      readonly type: 'task-discarded';
      readonly projectId: string;
      readonly taskId: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isFailurePhase(value: unknown): value is GenerationTaskFailurePhase {
  return value === 'prepare' || value === 'agent' || value === 'post-process';
}

export function isGenerationTaskStatus(
  value: unknown,
): value is GenerationTaskStatus {
  return (
    value === 'created' ||
    value === 'prepared' ||
    value === 'agent-assigned' ||
    value === 'agent-completed' ||
    value === 'post-processed' ||
    value === 'failed' ||
    value === 'cancelled'
  );
}

function isGenerationTaskFailureView(
  value: unknown,
): value is GenerationTaskFailureView {
  return (
    isRecord(value) &&
    isFailurePhase(value.phase) &&
    isTime(value.failedTime) &&
    isRequiredText(value.message) &&
    (value.code === undefined || isRequiredText(value.code)) &&
    (value.detail === undefined || isRequiredText(value.detail))
  );
}

export function isGenerationTaskView(
  value: unknown,
): value is GenerationTaskView {
  return (
    isRecord(value) &&
    isRequiredText(value.id) &&
    isRequiredText(value.projectId) &&
    isRequiredText(value.definitionId) &&
    Number.isSafeInteger(value.definitionVersion) &&
    Number(value.definitionVersion) > 0 &&
    isGenerationTaskStatus(value.status) &&
    (value.assignedProviderId === undefined ||
      isRequiredText(value.assignedProviderId)) &&
    (value.sessionId === undefined || isRequiredText(value.sessionId)) &&
    (value.result === undefined || isJsonValue(value.result)) &&
    isJsonValue(value.metrics) &&
    (value.failure === undefined ||
      isGenerationTaskFailureView(value.failure)) &&
    isTime(value.createdTime) &&
    isTime(value.updatedTime) &&
    Number(value.updatedTime) >= Number(value.createdTime)
  );
}

export function isGenerationTaskViewList(
  value: unknown,
): value is GenerationTaskView[] {
  return Array.isArray(value) && value.every(isGenerationTaskView);
}

function isAssetReferenceBindings(
  value: unknown,
): value is GenerationAssetReferenceBindings {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([slot, references]) =>
        /^[a-z][a-z0-9-]{0,63}$/u.test(slot) &&
        Array.isArray(references) &&
        references.every(
          (reference) =>
            isRecord(reference) && isRequiredText(reference.assetId),
        ),
    )
  );
}

export function isStartGenerationTaskRequest(
  value: unknown,
): value is StartGenerationTaskRequest {
  return (
    isRecord(value) &&
    isRequiredText(value.projectId) &&
    /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(
      String(value.definitionId),
    ) &&
    Number.isSafeInteger(value.definitionVersion) &&
    Number(value.definitionVersion) > 0 &&
    isJsonValue(value.instruction) &&
    isAssetReferenceBindings(value.assetReferences)
  );
}

export function isGenerationTaskProjectRequest(
  value: unknown,
): value is GenerationTaskProjectRequest {
  return isRecord(value) && isRequiredText(value.projectId);
}

export function isGenerationTaskIdRequest(
  value: unknown,
): value is GenerationTaskIdRequest {
  return (
    isRecord(value) &&
    isGenerationTaskProjectRequest(value) &&
    isRequiredText(value.taskId)
  );
}

function isGenerationExecutionEvent(
  value: unknown,
): value is GenerationExecutionEvent {
  if (!isRecord(value) || !isRequiredText(value.type)) {
    return false;
  }

  if (value.type === 'phase') {
    return (
      isFailurePhase(value.phase) &&
      (value.state === 'started' || value.state === 'completed')
    );
  }

  if (value.type === 'session-resolved') {
    return isRequiredText(value.sessionId);
  }

  if (value.type === 'assistant-delta') {
    return typeof value.delta === 'string';
  }

  if (value.type === 'tool-call') {
    return (
      (value.phase === 'started' || value.phase === 'completed') &&
      isRequiredText(value.callId) &&
      isRequiredText(value.toolName) &&
      (value.payload === undefined || isJsonValue(value.payload))
    );
  }

  if (value.type === 'status') {
    return isRequiredText(value.message);
  }

  return (
    value.type === 'output-rejected' &&
    Number.isSafeInteger(value.repairTurnNumber) &&
    Number(value.repairTurnNumber) > 0 &&
    Array.isArray(value.issues) &&
    value.issues.every(
      (issue) =>
        isRecord(issue) &&
        typeof issue.path === 'string' &&
        isRequiredText(issue.message),
    )
  );
}

export function isGenerationTaskEvent(
  value: unknown,
): value is GenerationTaskEvent {
  if (!isRecord(value) || !isRequiredText(value.type)) {
    return false;
  }

  if (value.type === 'task-changed' || value.type === 'task-completed') {
    return isGenerationTaskView(value.snapshot);
  }

  if (value.type === 'task-discarded') {
    return isRequiredText(value.projectId) && isRequiredText(value.taskId);
  }

  return (
    value.type === 'execution-event' &&
    isRequiredText(value.projectId) &&
    isRequiredText(value.taskId) &&
    isGenerationExecutionEvent(value.event)
  );
}

export function cloneStartGenerationTaskRequest(
  value: StartGenerationTaskRequest,
): StartGenerationTaskRequest {
  if (!isStartGenerationTaskRequest(value)) {
    throw new Error('StartGenerationTaskRequest 数据无效');
  }

  return Object.freeze({
    projectId: value.projectId.trim(),
    definitionId: value.definitionId.trim(),
    definitionVersion: value.definitionVersion,
    instruction: cloneJsonValue(value.instruction),
    assetReferences: Object.freeze(
      Object.fromEntries(
        Object.entries(value.assetReferences).map(([slot, references]) => [
          slot,
          Object.freeze(
            references.map(({ assetId }) =>
              Object.freeze({ assetId: assetId.trim() }),
            ),
          ),
        ]),
      ),
    ),
  });
}
