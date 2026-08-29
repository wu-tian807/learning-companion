import type { DocumentConversationContext } from './document-conversation-context';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 从提问上下文中取出用户当初框选的原文（用于定位插入点）。 */
export function extractDocumentSelectionExact(
  context: DocumentConversationContext | undefined,
): string | undefined {
  const target = context?.target;
  const payload =
    target?.scope === 'content' && isRecord(target.anchorPayload)
      ? target.anchorPayload
      : undefined;
  if (payload) {
    if (Array.isArray(payload.ranges) && payload.ranges.length > 0) {
      const first = payload.ranges[0];
      if (
        isRecord(first) &&
        typeof first.exact === 'string' &&
        first.exact.length > 0
      ) {
        return first.exact;
      }
    }
    if (typeof payload.exact === 'string' && payload.exact.length > 0) {
      return payload.exact;
    }
  }
  return undefined;
}

/**
 * 在文档当前内容中定位“选中文字结束之后”的插入偏移。
 * 优先按 exact 文本搜索（容忍文档在提问后没有改动的情况）；
 * 找不到时回退到 ranges[0].end 源偏移。
 */
export function findDocumentSelectionInsertOffset(
  content: string,
  context: DocumentConversationContext | undefined,
): number | undefined {
  const exact = extractDocumentSelectionExact(context);
  if (exact) {
    const found = content.indexOf(exact);
    if (found >= 0) {
      return found + exact.length;
    }
  }

  const target = context?.target;
  const payload =
    target?.scope === 'content' && isRecord(target.anchorPayload)
      ? target.anchorPayload
      : undefined;
  if (
    Array.isArray(payload?.ranges) &&
    payload.ranges.length > 0 &&
    isRecord(payload.ranges[0]) &&
    Number.isSafeInteger(payload.ranges[0].end)
  ) {
    const end = Number(payload.ranges[0].end);
    if (end >= 0 && end <= content.length) {
      return end;
    }
  }
  return undefined;
}

/**
 * 在选中位置之后插入回复块，返回插入后的完整内容。
 * 定位失败时返回 undefined。
 */
export function insertAnswerBlockAtSelection(input: {
  readonly content: string;
  readonly context?: DocumentConversationContext;
  readonly block: string;
}): string | undefined {
  const offset = findDocumentSelectionInsertOffset(
    input.content,
    input.context,
  );
  if (offset === undefined) {
    return undefined;
  }
  return (
    input.content.slice(0, offset) +
    input.block +
    input.content.slice(offset)
  );
}

function normalizeLineEnding(text: string, lineEnding: string): string {
  if (lineEnding === 'crlf') {
    return text.replace(/\r?\n/gu, '\r\n');
  }
  return text.replace(/\r\n/gu, '\n');
}

/** 纯文本：生成用方括号标记的回复块。 */
export function buildPlainTextAnswerBlock(
  answer: string,
  lineEnding = 'lf',
): string {
  const body = answer.replace(/\s+$/u, '').split('\n');
  const block = ['[AI 回复]', ...body, '[/AI 回复]'].join('\n');
  return normalizeLineEnding(`\n${block}\n`, lineEnding);
}

/** Markdown：生成用方括号标记的回复块。 */
export function buildMarkdownAnswerBlock(
  answer: string,
  lineEnding = 'lf',
): string {
  const body = answer.replace(/\s+$/u, '').split('\n');
  const block = ['[AI 回复]', ...body, '[/AI 回复]'].join('\n');
  return normalizeLineEnding(`\n${block}\n`, lineEnding);
}
