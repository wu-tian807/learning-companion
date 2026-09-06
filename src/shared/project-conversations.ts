import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from './workbench/protocol';

export const PROJECT_CONVERSATION_MAX_CONVERSATIONS = 1_000;
export const PROJECT_CONVERSATION_MAX_MESSAGES = 2_000;
export const PROJECT_CONVERSATION_MAX_TEXT_LENGTH = 32_768;
export const PROJECT_CONVERSATION_MAX_CONTEXT_BYTES = 64 * 1_024;
export const PROJECT_CONVERSATION_MODE_ID = 'project.general';

const CONVERSATION_MODE_ID_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;
const CONVERSATION_WORKSPACE_INSTANCE_KEY_PATTERN =
  /^[A-Za-z0-9._-]{1,160}$/u;

export type ConversationRole = 'user' | 'assistant';

/**
 * Stable Agent Workspace instance selected by the owning conversation mode.
 * The TaskDefinition still owns the workspace namespace and permissions.
 */
export type ConversationWorkspaceBinding = JsonValue &
  Readonly<{ instanceKey: string }>;

export interface ConversationReanswerBackup {
  readonly text: string;
  readonly generationTaskId?: string;
  readonly modelInfo?: string;
  readonly stopped?: true;
}

export interface ConversationMessageContextSource {
  /** Main provider that prepares this one message's optional Workbench context. */
  readonly contextProviderId: string;
  readonly assetId?: string;
  /** Additional read-only assets attached to this message's workspace. */
  readonly contextAssetIds?: readonly string[];
  readonly sourceAssetMode?: 'identity' | 'reference';
  readonly commitAnswer?: true;
}

export interface ConversationMessageRecord {
  readonly id: string;
  readonly role: ConversationRole;
  readonly text: string;
  readonly createdTime: number;
  readonly replyToMessageId?: string;
  readonly generationTaskId?: string;
  readonly context?: JsonValue;
  readonly contextSource?: ConversationMessageContextSource;
  readonly modelInfo?: string;
  readonly stopped?: true;
  /** Persisted until a replacement answer completes so failure/restart can restore it. */
  readonly reanswerBackup?: ConversationReanswerBackup;
}

export interface ConversationRecord {
  readonly id: string;
  readonly modeId: string;
  readonly workspace?: ConversationWorkspaceBinding;
  readonly title: string;
  readonly messages: readonly ConversationMessageRecord[];
  readonly createdTime: number;
  readonly updatedTime: number;
}

export interface ProjectConversationProjectRequest {
  readonly projectId: string;
}

export interface SaveProjectConversationRequest
  extends ProjectConversationProjectRequest {
  readonly conversation: ConversationRecord;
}

export interface DeleteProjectConversationRequest
  extends ProjectConversationProjectRequest {
  readonly conversationId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(
  value: unknown,
  maximum = PROJECT_CONVERSATION_MAX_TEXT_LENGTH,
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

export function isConversationWorkspaceBinding(
  value: unknown,
): value is ConversationWorkspaceBinding {
  return (
    isRecord(value) &&
    typeof value.instanceKey === 'string' &&
    CONVERSATION_WORKSPACE_INSTANCE_KEY_PATTERN.test(value.instanceKey)
  );
}

export function cloneConversationWorkspaceBinding(
  value: ConversationWorkspaceBinding,
): ConversationWorkspaceBinding {
  if (!isConversationWorkspaceBinding(value)) {
    throw new Error('Conversation Workspace Binding 数据无效');
  }
  return Object.freeze({ instanceKey: value.instanceKey });
}

function isTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isBoundedContext(value: unknown): value is JsonValue | undefined {
  return (
    value === undefined ||
    (isJsonValue(value) &&
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
        PROJECT_CONVERSATION_MAX_CONTEXT_BYTES)
  );
}

function isReanswerBackup(
  value: unknown,
): value is ConversationReanswerBackup {
  if (!isRecord(value)) return false;
  return (
    typeof value.text === 'string' &&
    value.text.length <= PROJECT_CONVERSATION_MAX_TEXT_LENGTH &&
    (value.generationTaskId === undefined ||
      isRequiredText(value.generationTaskId, 160)) &&
    (value.modelInfo === undefined || isRequiredText(value.modelInfo, 256)) &&
    (value.stopped === undefined || value.stopped === true)
  );
}

function isConversationMessageContextSource(
  value: unknown,
): value is ConversationMessageContextSource {
  if (!isRecord(value)) return false;
  return (
    isRequiredText(value.contextProviderId, 160) &&
    (value.assetId === undefined || isRequiredText(value.assetId, 160)) &&
    (value.sourceAssetMode === undefined ||
      value.sourceAssetMode === 'identity' ||
      value.sourceAssetMode === 'reference') &&
    (value.sourceAssetMode === undefined || value.assetId !== undefined) &&
    (value.contextAssetIds === undefined ||
      (Array.isArray(value.contextAssetIds) &&
        value.contextAssetIds.length <= 32 &&
        value.contextAssetIds.every((id) => isRequiredText(id, 160)) &&
        new Set(value.contextAssetIds).size === value.contextAssetIds.length)) &&
    (value.commitAnswer === undefined || value.commitAnswer === true)
  );
}

export function isConversationMessageRecord(
  value: unknown,
): value is ConversationMessageRecord {
  if (!isRecord(value)) return false;
  return (
    isRequiredText(value.id, 160) &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.text === 'string' &&
    value.text.length <= PROJECT_CONVERSATION_MAX_TEXT_LENGTH &&
    isTime(value.createdTime) &&
    (value.replyToMessageId === undefined ||
      isRequiredText(value.replyToMessageId, 160)) &&
    (value.generationTaskId === undefined ||
      isRequiredText(value.generationTaskId, 160)) &&
    isBoundedContext(value.context) &&
    (value.contextSource === undefined ||
      (value.role === 'user' &&
        isConversationMessageContextSource(value.contextSource))) &&
    (value.modelInfo === undefined || isRequiredText(value.modelInfo, 256)) &&
    (value.stopped === undefined || value.stopped === true) &&
    (value.reanswerBackup === undefined ||
      (value.role === 'assistant' &&
        isReanswerBackup(value.reanswerBackup)))
  );
}

export function isConversationRecord(
  value: unknown,
): value is ConversationRecord {
  if (!isRecord(value)) return false;
  return (
    isRequiredText(value.id, 160) &&
    typeof value.modeId === 'string' &&
    CONVERSATION_MODE_ID_PATTERN.test(value.modeId) &&
    (value.workspace === undefined ||
      isConversationWorkspaceBinding(value.workspace)) &&
    isRequiredText(value.title, 128) &&
    Array.isArray(value.messages) &&
    value.messages.length <= PROJECT_CONVERSATION_MAX_MESSAGES &&
    value.messages.every(isConversationMessageRecord) &&
    isTime(value.createdTime) &&
    isTime(value.updatedTime) &&
    Number(value.updatedTime) >= Number(value.createdTime)
  );
}

function cloneReanswerBackup(
  backup: ConversationReanswerBackup,
): ConversationReanswerBackup {
  return Object.freeze({
    text: backup.text,
    ...(backup.generationTaskId
      ? { generationTaskId: backup.generationTaskId }
      : {}),
    ...(backup.modelInfo ? { modelInfo: backup.modelInfo } : {}),
    ...(backup.stopped ? { stopped: true as const } : {}),
  });
}

export function cloneConversationRecord(
  value: ConversationRecord,
): ConversationRecord {
  if (!isConversationRecord(value)) {
    throw new Error('Project Conversation 数据无效');
  }
  return Object.freeze({
    id: value.id,
    modeId: value.modeId,
    ...(value.workspace
      ? { workspace: cloneConversationWorkspaceBinding(value.workspace) }
      : {}),
    title: value.title,
    messages: Object.freeze(
      value.messages.map((message) =>
        Object.freeze({
          id: message.id,
          role: message.role,
          text: message.text,
          createdTime: message.createdTime,
          ...(message.replyToMessageId
            ? { replyToMessageId: message.replyToMessageId }
            : {}),
          ...(message.generationTaskId
            ? { generationTaskId: message.generationTaskId }
            : {}),
          ...(message.context === undefined
            ? {}
            : { context: cloneJsonValue(message.context) }),
          ...(message.contextSource
            ? {
                contextSource: Object.freeze({
                  contextProviderId: message.contextSource.contextProviderId,
                  ...(message.contextSource.assetId
                    ? { assetId: message.contextSource.assetId }
                    : {}),
                  ...(message.contextSource.contextAssetIds
                    ? {
                        contextAssetIds: Object.freeze(
                          [...message.contextSource.contextAssetIds],
                        ),
                      }
                    : {}),
                  ...(message.contextSource.sourceAssetMode
                    ? {
                        sourceAssetMode:
                          message.contextSource.sourceAssetMode,
                      }
                    : {}),
                  ...(message.contextSource.commitAnswer
                    ? { commitAnswer: true as const }
                    : {}),
                }),
              }
            : {}),
          ...(message.modelInfo ? { modelInfo: message.modelInfo } : {}),
          ...(message.stopped ? { stopped: true } : {}),
          ...(message.reanswerBackup
            ? {
                reanswerBackup: cloneReanswerBackup(
                  message.reanswerBackup,
                ),
              }
            : {}),
        }),
      ),
    ),
    createdTime: value.createdTime,
    updatedTime: value.updatedTime,
  });
}

export function cloneConversationRecords(
  value: readonly ConversationRecord[],
): readonly ConversationRecord[] {
  if (
    !Array.isArray(value) ||
    value.length > PROJECT_CONVERSATION_MAX_CONVERSATIONS
  ) {
    throw new Error('Project Conversation 列表数据无效');
  }
  const ids = new Set<string>();
  const records = value.map((record) => {
    const cloned = cloneConversationRecord(record);
    if (ids.has(cloned.id)) {
      throw new Error('Project Conversation id 重复');
    }
    ids.add(cloned.id);
    return cloned;
  });
  return Object.freeze(records);
}
