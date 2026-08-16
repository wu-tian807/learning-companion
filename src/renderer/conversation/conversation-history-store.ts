import { isJsonValue, type JsonValue } from '../../shared/workbench/protocol';
import type {
  ConversationHistoryStore,
  ConversationMessageRecord,
  ConversationRecord,
} from './conversation-contracts';

const MAX_CONVERSATIONS = 1_000;
const MAX_MESSAGES = 2_000;
const MAX_TEXT_LENGTH = 32_768;
const MAX_CONTEXT_BYTES = 64 * 1_024;

export interface ConversationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface LocalConversationHistoryOptions {
  readonly key: string;
  readonly storage?: ConversationStorage;
  /** PR #35 stored Document AI as one flat message array. */
  readonly legacyMessageArrayKeys?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown, maximum = MAX_TEXT_LENGTH): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function isTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isBoundedContext(value: unknown): value is JsonValue | undefined {
  return (
    value === undefined ||
    (isJsonValue(value) &&
      new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_CONTEXT_BYTES)
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
    value.text.length <= MAX_TEXT_LENGTH &&
    isTime(value.createdTime) &&
    (value.replyToMessageId === undefined || isRequiredText(value.replyToMessageId, 160)) &&
    (value.generationTaskId === undefined || isRequiredText(value.generationTaskId, 160)) &&
    isBoundedContext(value.context) &&
    (value.modelInfo === undefined || isRequiredText(value.modelInfo, 256)) &&
    (value.stopped === undefined || value.stopped === true)
  );
}

export function isConversationRecord(value: unknown): value is ConversationRecord {
  if (!isRecord(value)) return false;
  return (
    isRequiredText(value.id, 160) &&
    isRequiredText(value.title, 128) &&
    Array.isArray(value.messages) &&
    value.messages.length <= MAX_MESSAGES &&
    value.messages.every(isConversationMessageRecord) &&
    isTime(value.createdTime) &&
    isTime(value.updatedTime) &&
    Number(value.updatedTime) >= Number(value.createdTime)
  );
}

function freezeRecord(record: ConversationRecord): ConversationRecord {
  return Object.freeze({
    id: record.id,
    title: record.title,
    messages: Object.freeze(record.messages.map((message) => Object.freeze({ ...message }))),
    createdTime: record.createdTime,
    updatedTime: record.updatedTime,
  });
}

function parseRecords(value: unknown): readonly ConversationRecord[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > MAX_CONVERSATIONS ||
    !value.every(isConversationRecord)
  ) {
    return undefined;
  }
  const ids = new Set<string>();
  for (const record of value) {
    if (ids.has(record.id)) return undefined;
    ids.add(record.id);
  }
  return Object.freeze(value.map(freezeRecord));
}

function legacyConversationTitle(content: string): string {
  const normalized = content
    .replace(/^\s*(?:Question|问题)\s*[:：]\s*/iu, '')
    .split(/\r?\n/u, 1)[0]
    ?.trim();
  return (normalized || '历史问答').slice(0, 32);
}

function migrateLegacyMessageArray(value: unknown): readonly ConversationRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const groups = new Map<string, ConversationMessageRecord[]>();
  const titles = new Map<string, string>();

  for (const item of value) {
    if (!isRecord(item)) return undefined;
    if (
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
    const context = item.anchor !== undefined && isBoundedContext(item.anchor)
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
      ...(isRequiredText(item.modelInfo, 256) ? { modelInfo: item.modelInfo } : {}),
      ...(context ? { context } : {}),
    };
    const current = groups.get(conversationId) ?? [];
    current.push(message);
    groups.set(conversationId, current);
    if (isRequiredText(item.conversationTitle, 128)) {
      titles.set(conversationId, item.conversationTitle.slice(0, 128));
    }
  }

  return Object.freeze([...groups.entries()].map(([id, messages]) => {
    const sorted = [...messages].sort((left, right) => left.createdTime - right.createdTime);
    const firstQuestion = sorted.find((message) => message.role === 'user');
    return freezeRecord({
      id,
      title: titles.get(id) ?? legacyConversationTitle(firstQuestion?.text ?? ''),
      messages: sorted,
      createdTime: sorted[0]?.createdTime ?? 0,
      updatedTime: sorted.at(-1)?.createdTime ?? 0,
    });
  }));
}

function defaultStorage(): ConversationStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function createLocalConversationHistoryStore({
  key,
  storage = defaultStorage(),
  legacyMessageArrayKeys = [],
}: LocalConversationHistoryOptions): ConversationHistoryStore {
  let memory: readonly ConversationRecord[] = [];
  let loaded = false;
  const listeners = new Set<() => void>();

  const write = (records: readonly ConversationRecord[]) => {
    memory = Object.freeze(records.map(freezeRecord));
    storage?.setItem(key, JSON.stringify(memory));
    for (const listener of [...listeners]) listener();
  };

  const load = (): readonly ConversationRecord[] => {
    if (loaded) return memory;
    loaded = true;
    if (!storage) return memory;
    try {
      const current = storage.getItem(key);
      if (current !== null) {
        memory = parseRecords(JSON.parse(current)) ?? [];
        return memory;
      }
      for (const legacyKey of legacyMessageArrayKeys) {
        const legacy = storage.getItem(legacyKey);
        if (legacy === null) continue;
        const migrated = migrateLegacyMessageArray(JSON.parse(legacy));
        if (migrated) {
          write(migrated);
          for (const migratedKey of legacyMessageArrayKeys) {
            storage.removeItem(migratedKey);
          }
          return memory;
        }
      }
    } catch {
      memory = [];
    }
    return memory;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return load();
    },
    async list() {
      return load();
    },
    async save(record) {
      if (!isConversationRecord(record)) {
        throw new Error('Conversation 历史记录无效');
      }
      const records = [...load()];
      const index = records.findIndex((candidate) => candidate.id === record.id);
      if (index >= 0) records[index] = freezeRecord(record);
      else records.push(freezeRecord(record));
      records.sort((left, right) => left.createdTime - right.createdTime);
      if (records.length > MAX_CONVERSATIONS) {
        records.splice(0, records.length - MAX_CONVERSATIONS);
      }
      write(records);
      return memory;
    },
    async remove(conversationId) {
      write(load().filter((record) => record.id !== conversationId));
      return memory;
    },
  };
}

export function createConversationHistoryKey(input: {
  readonly contributionId: string;
  readonly projectId: string;
  readonly assetId: string;
}): string {
  return [
    'learning-companion:conversation:v1',
    ...[
      input.contributionId,
      input.projectId,
      input.assetId,
    ].map(encodeURIComponent),
  ].join(':');
}
