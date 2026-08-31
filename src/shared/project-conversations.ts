import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from './workbench/protocol';

export const PROJECT_CONVERSATION_MAX_CONVERSATIONS = 1_000;
export const PROJECT_CONVERSATION_MAX_MESSAGES = 2_000;
export const PROJECT_CONVERSATION_MAX_TEXT_LENGTH = 32_768;
export const PROJECT_CONVERSATION_MAX_CONTEXT_BYTES = 64 * 1_024;

export type ConversationRole = 'user' | 'assistant';

export interface ConversationReanswerBackup {
  readonly text: string;
  readonly generationTaskId?: string;
  readonly modelInfo?: string;
  readonly stopped?: true;
}

export interface ConversationMessageRecord {
  readonly id: string;
  readonly role: ConversationRole;
  readonly text: string;
  readonly createdTime: number;
  readonly replyToMessageId?: string;
  readonly generationTaskId?: string;
  readonly context?: JsonValue;
  readonly modelInfo?: string;
  readonly stopped?: true;
  /** Persisted until a replacement answer completes so failure/restart can restore it. */
  readonly reanswerBackup?: ConversationReanswerBackup;
}

export interface ConversationRecord {
  readonly id: string;
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

export interface ImportProjectConversationsRequest
  extends ProjectConversationProjectRequest {
  readonly conversations: readonly ConversationRecord[];
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
