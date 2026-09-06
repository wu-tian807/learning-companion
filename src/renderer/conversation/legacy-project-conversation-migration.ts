import {
  cloneConversationRecords,
  isConversationRecord,
  PROJECT_CONVERSATION_MAX_CONTEXT_BYTES,
  PROJECT_CONVERSATION_MAX_CONVERSATIONS,
  PROJECT_CONVERSATION_MODE_ID,
  type ConversationMessageRecord,
  type ConversationRecord,
} from '../../shared/project-conversations';
import type { LearningCompanionApi } from '../../shared/ipc';
import { isJsonValue } from '../../shared/workbench/protocol';

const CURRENT_HISTORY_PREFIX = 'learning-companion:conversation:v1:';
const DOCUMENT_HISTORY_PREFIX = 'learning-companion:document-ai-history:v1:';

export interface LegacyConversationStorage {
  readonly length: number;
  getItem(key: string): string | null;
  removeItem(key: string): void;
  key(index: number): string | null;
}

type MigrationApi = Pick<
  LearningCompanionApi,
  'listProjectConversations' | 'saveProjectConversation'
>;

interface MigrationResult {
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

function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function keyDetails(
  key: string,
  projectId: string,
): { readonly kind: 'current' | 'document'; readonly assetId?: string } | undefined {
  if (key.startsWith(CURRENT_HISTORY_PREFIX)) {
    const parts = key.slice(CURRENT_HISTORY_PREFIX.length).split(':');
    if (parts.length === 3 && decode(parts[1] ?? '') === projectId) {
      return { kind: 'current', assetId: decode(parts[2] ?? '') };
    }
  }
  if (key.startsWith(DOCUMENT_HISTORY_PREFIX)) {
    const parts = key.slice(DOCUMENT_HISTORY_PREFIX.length).split(':');
    if (parts.length === 2 && decode(parts[0] ?? '') === projectId) {
      return { kind: 'document', assetId: decode(parts[1] ?? '') };
    }
  }
  return undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function time(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function title(value: string): string {
  return (
    value
      .replace(/^\s*(?:Question|问题)\s*[:：]\s*/iu, '')
      .split(/\r?\n/u, 1)[0]
      ?.trim() || '历史问答'
  ).slice(0, 32);
}

function boundedContext(value: unknown) {
  return value !== undefined &&
    isJsonValue(value) &&
    new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      PROJECT_CONVERSATION_MAX_CONTEXT_BYTES
    ? value
    : undefined;
}

function migrateMessages(
  value: unknown,
  assetId: string | undefined,
): readonly ConversationRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const groups = new Map<string, ConversationMessageRecord[]>();
  const titles = new Map<string, string>();
  const conversationByMessage = new Map<string, string>();
  let activeConversationId: string | undefined;

  for (const item of value) {
    if (
      !record(item) ||
      !text(item.id, 160) ||
      (item.role !== 'user' && item.role !== 'assistant') ||
      typeof item.content !== 'string' ||
      !time(item.timestamp)
    ) {
      return undefined;
    }
    const explicitId = text(item.conversationId, 160)
      ? item.conversationId
      : undefined;
    const replyConversation = text(item.replyToMessageId, 160)
      ? conversationByMessage.get(item.replyToMessageId)
      : undefined;
    if (item.role === 'user' && item.anchor !== undefined && !explicitId) {
      activeConversationId = `legacy-${item.id}`;
    }
    const conversationId =
      explicitId ?? replyConversation ?? activeConversationId ?? `legacy-${item.id}`;
    activeConversationId = conversationId;
    conversationByMessage.set(item.id, conversationId);
    const context = boundedContext(item.anchor);
    const message: ConversationMessageRecord = {
      id: item.id,
      role: item.role,
      text: item.content,
      createdTime: item.timestamp,
      ...(text(item.replyToMessageId, 160)
        ? { replyToMessageId: item.replyToMessageId }
        : {}),
      ...(text(item.modelInfo, 256) ? { modelInfo: item.modelInfo } : {}),
      ...(context === undefined ? {} : { context }),
      ...(item.role === 'user' && context !== undefined && assetId
        ? {
            contextSource: {
              contextProviderId: 'document-ai.context',
              assetId,
              sourceAssetMode: 'reference' as const,
              commitAnswer: true as const,
            },
          }
        : {}),
    };
    const messages = groups.get(conversationId) ?? [];
    messages.push(message);
    groups.set(conversationId, messages);
    if (text(item.conversationTitle, 128)) {
      titles.set(conversationId, item.conversationTitle.slice(0, 128));
    }
  }

  try {
    return cloneConversationRecords(
      [...groups.entries()].map(([id, messages]) => {
        const sorted = [...messages].sort((a, b) => a.createdTime - b.createdTime);
        const firstQuestion = sorted.find((message) => message.role === 'user');
        return {
          id: `legacy-${assetId ?? 'project'}-${id}`.slice(0, 160),
          modeId: PROJECT_CONVERSATION_MODE_ID,
          title: titles.get(id) ?? title(firstQuestion?.text ?? ''),
          messages: sorted,
          createdTime: sorted[0]?.createdTime ?? 0,
          updatedTime: sorted.at(-1)?.createdTime ?? 0,
        };
      }),
    );
  } catch {
    return undefined;
  }
}

function migrateCurrentRecords(value: unknown): readonly ConversationRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    return cloneConversationRecords(
      value.map((item) => {
        if (!record(item)) throw new Error('invalid legacy conversation');
        return isConversationRecord(item)
          ? item
          : { ...item, modeId: PROJECT_CONVERSATION_MODE_ID };
      }) as ConversationRecord[],
    );
  } catch {
    return undefined;
  }
}

export function collectLegacyProjectConversations(
  projectId: string,
  storage: LegacyConversationStorage | undefined = defaultStorage(),
): MigrationResult {
  if (!storage) return { records: [], keys: [] };
  const byId = new Map<string, ConversationRecord>();
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    const details = keyDetails(key, projectId);
    if (!details) continue;
    const serialized = storage.getItem(key);
    if (serialized === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      continue;
    }
    const records = details.kind === 'current'
      ? migrateCurrentRecords(parsed)
      : migrateMessages(parsed, details.assetId);
    if (!records) continue;
    keys.push(key);
    for (const item of records) {
      const existing = byId.get(item.id);
      if (!existing || item.updatedTime > existing.updatedTime) byId.set(item.id, item);
    }
  }
  return {
    records: cloneConversationRecords(
      [...byId.values()]
        .sort((a, b) => b.updatedTime - a.updatedTime)
        .slice(0, PROJECT_CONVERSATION_MAX_CONVERSATIONS),
    ),
    keys,
  };
}

export async function migrateLegacyProjectConversations({
  projectId,
  api,
  storage = defaultStorage(),
}: {
  readonly projectId: string;
  readonly api: MigrationApi;
  readonly storage?: LegacyConversationStorage;
}): Promise<readonly ConversationRecord[] | undefined> {
  const migration = collectLegacyProjectConversations(projectId, storage);
  if (migration.keys.length === 0) return undefined;
  let records = await api.listProjectConversations({ projectId });
  for (const conversation of migration.records) {
    records = await api.saveProjectConversation({ projectId, conversation });
  }
  for (const key of migration.keys) storage?.removeItem(key);
  return records;
}
