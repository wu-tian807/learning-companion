/**
 * Conversation index protocol for the HTML assistant.
 *
 * The conversation log is persisted in `workbench_state_data` under a single
 * html-workbench-private key. Only a compact index is stored locally:
 * question / answer / anchor summary / createdTime. The authoritative Codex
 * thread history is read from the provider when the UI needs full messages.
 *
 * Pure data module: no database, no Electron, no renderer imports.
 */
import {
  isJsonValue,
  type JsonValue,
} from '../../../shared/workbench/protocol';

export const HTML_CONVERSATION_DATA_KEY = 'html-conversations-v1';
export const HTML_CONVERSATION_INDEX_FORMAT =
  'learning-companion/html-conversation-index';
export const HTML_CONVERSATION_INDEX_VERSION = 1;

export const HTML_CONVERSATION_MAX_ENTRIES = 1_000;
export const HTML_CONVERSATION_ID_MAX_LENGTH = 128;
export const HTML_CONVERSATION_TEXT_MAX_LENGTH = 32_768;
export const HTML_CONVERSATION_ANCHOR_MAX_BYTES = 8_192;

export type HtmlConversationEntry = JsonValue & {
  /** Stable identity of one question/answer round. */
  readonly id: string;
  /** Serialized ContentAnchorTarget.anchorPayload (html.quote / html.element / html.link). */
  readonly anchor?: JsonValue;
  readonly question: string;
  readonly answer: string;
  readonly createdTime: number;
};

export type HtmlConversationIndexV1 = JsonValue & {
  readonly format: typeof HTML_CONVERSATION_INDEX_FORMAT;
  readonly version: typeof HTML_CONVERSATION_INDEX_VERSION;
  readonly entries: readonly HtmlConversationEntry[];
};

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

function isTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function isHtmlConversationEntry(
  value: unknown,
): value is HtmlConversationEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isBoundedText(value.id, HTML_CONVERSATION_ID_MAX_LENGTH) &&
    (value.anchor === undefined || isJsonValue(value.anchor)) &&
    isBoundedText(value.question, HTML_CONVERSATION_TEXT_MAX_LENGTH) &&
    isBoundedText(value.answer, HTML_CONVERSATION_TEXT_MAX_LENGTH) &&
    isTime(value.createdTime)
  );
}

export function isHtmlConversationIndexV1(
  value: unknown,
): value is HtmlConversationIndexV1 {
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

  for (const entry of value.entries) {
    if (entry.createdTime < previousTime) {
      return false;
    }
    previousTime = entry.createdTime;
  }

  return true;
}

export function createHtmlConversationIndex(): HtmlConversationIndexV1 {
  return Object.freeze({
    format: HTML_CONVERSATION_INDEX_FORMAT,
    version: HTML_CONVERSATION_INDEX_VERSION,
    entries: Object.freeze([]),
  });
}

export function appendHtmlConversationEntry(
  index: HtmlConversationIndexV1,
  entry: HtmlConversationEntry,
): HtmlConversationIndexV1 {
  if (!isHtmlConversationIndexV1(index)) {
    throw new Error('HtmlConversationIndex 数据无效');
  }
  if (!isHtmlConversationEntry(entry)) {
    throw new Error('HtmlConversationEntry 数据无效');
  }
  if (index.entries.length >= HTML_CONVERSATION_MAX_ENTRIES) {
    throw new Error('HtmlConversationIndex 已达到条数上限');
  }

  const previous = index.entries[index.entries.length - 1];

  if (previous && entry.createdTime < previous.createdTime) {
    throw new Error('HtmlConversationEntry 时间戳不能早于上一条');
  }

  return Object.freeze({
    format: index.format,
    version: index.version,
    entries: Object.freeze([...index.entries, entry]),
  });
}
