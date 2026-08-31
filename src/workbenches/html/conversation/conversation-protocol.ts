/** Legacy HTML-only history decoder used solely by database migration 0024. */
import {
  type JsonValue,
} from '../../../shared/workbench/protocol';
import { isHtmlAnchorTarget } from '../anchor-commands';
import {
  HTML_CONVERSATION_ID_MAX_LENGTH,
  isHtmlConversationId,
} from './conversation-id';

export { HTML_CONVERSATION_ID_MAX_LENGTH } from './conversation-id';

export const HTML_CONVERSATION_DATA_KEY = 'html-conversations-v1';
export const HTML_CONVERSATION_INDEX_FORMAT =
  'learning-companion/html-conversation-index';
export const HTML_CONVERSATION_INDEX_VERSION = 2;

export const HTML_CONVERSATION_MAX_ENTRIES = 1_000;
export const HTML_CONVERSATION_MAX_MESSAGES = 2_000;
export const HTML_CONVERSATION_TEXT_MAX_LENGTH = 32_768;
export const HTML_CONVERSATION_ANCHOR_MAX_BYTES = 8_192;
export const HTML_CONVERSATION_TASK_ID_MAX_LENGTH = 128;

export type HtmlConversationMessage = JsonValue & {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  /** Main-owned task identity used to recover a task after reload. */
  readonly generationTaskId?: string;
  /** The content anchor consumed by this particular message. */
  readonly anchor?: JsonValue;
  /** 取消（停止）后保留的半截回答。 */
  readonly stopped?: boolean;
};

export type HtmlConversationEntry = JsonValue & {
  /** Stable identity, preserved when a restored conversation is continued. */
  readonly id: string;
  readonly messages: readonly HtmlConversationMessage[];
  readonly createdTime: number;
  readonly updatedTime: number;
};

export type HtmlConversationIndex = JsonValue & {
  readonly format: typeof HTML_CONVERSATION_INDEX_FORMAT;
  readonly version: typeof HTML_CONVERSATION_INDEX_VERSION;
  readonly entries: readonly HtmlConversationEntry[];
};

interface LegacyHtmlConversationEntry {
  readonly id: string;
  readonly anchor?: JsonValue;
  readonly question: string;
  readonly answer: string;
  readonly createdTime: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximumLength
  );
}

function isMessageText(
  role: 'user' | 'assistant',
  value: unknown,
  generationTaskId: unknown,
): value is string {
  // An acknowledged assistant task may have no delta yet. Persisting that
  // empty placeholder is what lets a restart recover the task association.
  return role === 'assistant' && generationTaskId !== undefined
    ? typeof value === 'string' && value.length <= HTML_CONVERSATION_TEXT_MAX_LENGTH
    : isBoundedText(value, HTML_CONVERSATION_TEXT_MAX_LENGTH);
}

function isTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isBoundedAnchor(value: unknown): boolean {
  return (
    value !== undefined &&
    isHtmlAnchorTarget(value) &&
    new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      HTML_CONVERSATION_ANCHOR_MAX_BYTES
  );
}

export function isHtmlConversationMessage(
  value: unknown,
): value is HtmlConversationMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.role === 'user' || value.role === 'assistant') &&
    isMessageText(value.role, value.text, value.generationTaskId) &&
    (value.generationTaskId === undefined ||
      isBoundedText(
        value.generationTaskId,
        HTML_CONVERSATION_TASK_ID_MAX_LENGTH,
      )) &&
    (value.anchor === undefined || isBoundedAnchor(value.anchor)) &&
    (value.stopped === undefined || value.stopped === true)
  );
}

export function isHtmlConversationEntry(
  value: unknown,
): value is HtmlConversationEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isHtmlConversationId(value.id) &&
    Array.isArray(value.messages) &&
    value.messages.length > 0 &&
    value.messages.length <= HTML_CONVERSATION_MAX_MESSAGES &&
    value.messages.every(isHtmlConversationMessage) &&
    isTime(value.createdTime) &&
    isTime(value.updatedTime) &&
    Number(value.updatedTime) >= Number(value.createdTime)
  );
}

export function isHtmlConversationIndex(
  value: unknown,
): value is HtmlConversationIndex {
  if (
    !isRecord(value) ||
    value.format !== HTML_CONVERSATION_INDEX_FORMAT ||
    value.version !== HTML_CONVERSATION_INDEX_VERSION ||
    !Array.isArray(value.entries) ||
    value.entries.length > HTML_CONVERSATION_MAX_ENTRIES ||
    !value.entries.every(isHtmlConversationEntry)
  ) {
    return false;
  }

  let previousTime = -1;
  const ids = new Set<string>();

  for (const entry of value.entries) {
    if (entry.createdTime < previousTime || ids.has(entry.id)) {
      return false;
    }
    previousTime = entry.createdTime;
    ids.add(entry.id);
  }

  return true;
}

function isLegacyHtmlConversationEntry(
  value: unknown,
): value is LegacyHtmlConversationEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isHtmlConversationId(value.id) &&
    isBoundedText(value.question, HTML_CONVERSATION_TEXT_MAX_LENGTH) &&
    isBoundedText(value.answer, HTML_CONVERSATION_TEXT_MAX_LENGTH) &&
    isTime(value.createdTime) &&
    (value.anchor === undefined || isBoundedAnchor(value.anchor))
  );
}

function freezeEntry(entry: HtmlConversationEntry): HtmlConversationEntry {
  return Object.freeze({
    id: entry.id,
    messages: Object.freeze(
      entry.messages.map((message) =>
        Object.freeze({
          role: message.role,
          text: message.text,
          ...(message.generationTaskId === undefined
            ? {}
            : { generationTaskId: message.generationTaskId }),
          ...(message.anchor === undefined ? {} : { anchor: message.anchor }),
          ...(message.stopped === undefined ? {} : { stopped: message.stopped }),
        }),
      ),
    ),
    createdTime: entry.createdTime,
    updatedTime: entry.updatedTime,
  }) as HtmlConversationEntry;
}

function migrateEntry(value: unknown): HtmlConversationEntry | undefined {
  if (isHtmlConversationEntry(value)) {
    return freezeEntry(value);
  }
  if (!isLegacyHtmlConversationEntry(value)) {
    return undefined;
  }

  return freezeEntry({
    id: value.id,
    messages: [
      {
        role: 'user',
        text: value.question,
        ...(value.anchor === undefined ? {} : { anchor: value.anchor }),
      },
      { role: 'assistant', text: value.answer },
    ],
    createdTime: value.createdTime,
    updatedTime: value.createdTime,
  });
}

function withUniqueMigratedId(
  entry: HtmlConversationEntry,
  usedIds: Set<string>,
): HtmlConversationEntry {
  if (!usedIds.has(entry.id)) {
    usedIds.add(entry.id);
    return entry;
  }

  let suffixNumber = 2;
  let candidate: string;
  do {
    const suffix = `~${suffixNumber}`;
    candidate = `${entry.id.slice(
      0,
      HTML_CONVERSATION_ID_MAX_LENGTH - suffix.length,
    )}${suffix}`;
    suffixNumber += 1;
  } while (usedIds.has(candidate));

  usedIds.add(candidate);
  return freezeEntry({
    id: candidate,
    messages: entry.messages,
    createdTime: entry.createdTime,
    updatedTime: entry.updatedTime,
  });
}

/**
 * Reads v2, the original v1 Q/A shape, and the short-lived transitional v1
 * message shape. Invalid data returns undefined so callers can recover safely.
 */
export function normalizeHtmlConversationIndex(
  value: unknown,
): HtmlConversationIndex | undefined {
  if (!isRecord(value) || value.format !== HTML_CONVERSATION_INDEX_FORMAT) {
    return undefined;
  }
  if (value.version !== 1 && value.version !== HTML_CONVERSATION_INDEX_VERSION) {
    return undefined;
  }
  if (
    !Array.isArray(value.entries) ||
    value.entries.length > HTML_CONVERSATION_MAX_ENTRIES
  ) {
    return undefined;
  }

  const entries: HtmlConversationEntry[] = [];
  const usedIds = new Set<string>();
  for (const valueEntry of value.entries) {
    const entry = migrateEntry(valueEntry);
    if (!entry) {
      return undefined;
    }
    entries.push(
      value.version === 1
        ? withUniqueMigratedId(entry, usedIds)
        : entry,
    );
  }

  entries.sort(
    (left, right) =>
      left.createdTime - right.createdTime || left.id.localeCompare(right.id),
  );
  try {
    const index = createHtmlConversationIndexWith(entries);
    return isHtmlConversationIndex(index) ? index : undefined;
  } catch {
    return undefined;
  }
}

function createHtmlConversationIndexWith(
  entries: readonly HtmlConversationEntry[],
): HtmlConversationIndex {
  if (entries.length > HTML_CONVERSATION_MAX_ENTRIES) {
    throw new Error('HtmlConversationIndex 已达到条数上限');
  }

  const index = Object.freeze({
    format: HTML_CONVERSATION_INDEX_FORMAT,
    version: HTML_CONVERSATION_INDEX_VERSION,
    entries: Object.freeze(entries.map(freezeEntry)),
  });

  if (!isHtmlConversationIndex(index)) {
    throw new Error('HtmlConversationIndex 数据无效');
  }
  return index;
}
