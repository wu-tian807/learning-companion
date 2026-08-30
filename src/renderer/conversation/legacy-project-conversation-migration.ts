import {
  cloneConversationRecords,
  isConversationRecord,
  PROJECT_CONVERSATION_MAX_CONTEXT_BYTES,
  PROJECT_CONVERSATION_MAX_CONVERSATIONS,
  type ConversationMessageRecord,
  type ConversationRecord,
} from '../../shared/project-conversations';
import type { LearningCompanionApi } from '../../shared/ipc';
import { isJsonValue } from '../../shared/workbench/protocol';

const CURRENT_HISTORY_PREFIX = 'learning-companion:conversation:v1:';
const LEGACY_DOCUMENT_HISTORY_PREFIX =
  'learning-companion:document-ai-history:v1:';

export interface LegacyConversationStorage {
  readonly length: number;
  getItem(key: string): string | null;
  removeItem(key: string): void;
  key(index: number): string | null;
}

export type LegacyProjectConversationMigrationApi = Pick<
  LearningCompanionApi,
  'listProjectConversations' | 'importProjectConversations'
>;

interface LegacyMigration {
  readonly records: readonly ConversationRecord[];
  readonly keys: readonly string[];
}

function defaultStorage(): LegacyConversationStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function decodeKeySegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function belongsToProject(key: string, projectId: string): boolean {
  if (key.startsWith(CURRENT_HISTORY_PREFIX)) {
    const segments = key.slice(CURRENT_HISTORY_PREFIX.length).split(':');
    return (
      segments.length === 3 &&
      decodeKeySegment(segments[1] ?? '') === projectId
    );
  }
  if (key.startsWith(LEGACY_DOCUMENT_HISTORY_PREFIX)) {
    const segments = key
      .slice(LEGACY_DOCUMENT_HISTORY_PREFIX.length)
      .split(':');
    return (
      segments.length === 2 &&
      decodeKeySegment(segments[0] ?? '') === projectId
    );
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function isTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function legacyConversationTitle(content: string): string {
  const normalized = content
    .replace(/^\s*(?:Question|问题)\s*[:：]\s*/iu, '')
    .split(/\r?\n/u, 1)[0]
    ?.trim();
  return (normalized || '历史问答').slice(0, 32);
}

function migrateLegacyMessageArray(
  value: unknown,
): readonly ConversationRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const groups = new Map<string, ConversationMessageRecord[]>();
  const titles = new Map<string, string>();

  for (const item of value) {
    if (
      !isRecord(item) ||
      !isRequiredText(item.id, 160) ||
      (item.role !== 'user' && item.role !== 'assistant') ||
      typeof item.content !== 'string' ||
      !isTime(item.timestamp)
    ) {
      return undefined;
    }
    const conversationId = isRequiredText(item.conversationId, 160)
      ? item.conversationId
      : `legacy-${item.id}`;
    const context =
      item.anchor !== undefined &&
      isJsonValue(item.anchor) &&
      new TextEncoder().encode(JSON.stringify(item.anchor)).byteLength <=
        PROJECT_CONVERSATION_MAX_CONTEXT_BYTES
        ? item.anchor
        : undefined;
    const message: ConversationMessageRecord = {
      id: item.id,
      role: item.role,
      text: item.content,
      createdTime: item.timestamp,
      ...(isRequiredText(item.replyToMessageId, 160)
        ? { replyToMessageId: item.replyToMessageId }
        : {}),
      ...(isRequiredText(item.modelInfo, 256)
        ? { modelInfo: item.modelInfo }
        : {}),
      ...(context === undefined ? {} : { context }),
    };
    const current = groups.get(conversationId) ?? [];
    current.push(message);
    groups.set(conversationId, current);
    if (isRequiredText(item.conversationTitle, 128)) {
      titles.set(conversationId, item.conversationTitle.slice(0, 128));
    }
  }

  const records = [...groups.entries()].map(([id, messages]) => {
    const sorted = [...messages].sort(
      (left, right) => left.createdTime - right.createdTime,
    );
    const firstQuestion = sorted.find((message) => message.role === 'user');
    return {
      id,
      title:
        titles.get(id) ??
        legacyConversationTitle(firstQuestion?.text ?? ''),
      messages: sorted,
      createdTime: sorted[0]?.createdTime ?? 0,
      updatedTime: sorted.at(-1)?.createdTime ?? 0,
    } satisfies ConversationRecord;
  });
  try {
    return cloneConversationRecords(records);
  } catch {
    return undefined;
  }
}

function parseCurrentRecords(
  value: unknown,
): readonly ConversationRecord[] | undefined {
  if (!Array.isArray(value) || !value.every(isConversationRecord)) {
    return undefined;
  }
  try {
    return cloneConversationRecords(value);
  } catch {
    return undefined;
  }
}

export function collectLegacyProjectConversations(
  projectId: string,
  storage: LegacyConversationStorage | undefined = defaultStorage(),
): LegacyMigration {
  if (!storage) return { records: [], keys: [] };
  const byId = new Map<string, ConversationRecord>();
  const keys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !belongsToProject(key, projectId)) continue;
    const serialized = storage.getItem(key);
    if (serialized === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      continue;
    }
    const records = key.startsWith(CURRENT_HISTORY_PREFIX)
      ? parseCurrentRecords(parsed)
      : migrateLegacyMessageArray(parsed);
    if (!records) continue;
    keys.push(key);
    for (const record of records) {
      const existing = byId.get(record.id);
      if (!existing || record.updatedTime > existing.updatedTime) {
        byId.set(record.id, record);
      }
    }
  }

  const records = [...byId.values()]
    .sort(
      (left, right) =>
        right.updatedTime - left.updatedTime ||
        left.id.localeCompare(right.id),
    )
    .slice(0, PROJECT_CONVERSATION_MAX_CONVERSATIONS)
    .sort(
      (left, right) =>
        left.createdTime - right.createdTime ||
        left.id.localeCompare(right.id),
    );
  return Object.freeze({
    records: cloneConversationRecords(records),
    keys: Object.freeze(keys),
  });
}

export async function migrateLegacyProjectConversations({
  projectId,
  api,
  storage = defaultStorage(),
}: {
  readonly projectId: string;
  readonly api: LegacyProjectConversationMigrationApi;
  readonly storage?: LegacyConversationStorage;
}): Promise<readonly ConversationRecord[] | undefined> {
  const migration = collectLegacyProjectConversations(projectId, storage);
  if (migration.keys.length === 0) return undefined;
  const records =
    migration.records.length > 0
      ? await api.importProjectConversations({
          projectId,
          conversations: migration.records,
        })
      : await api.listProjectConversations({ projectId });
  for (const key of migration.keys) storage?.removeItem(key);
  return records;
}
