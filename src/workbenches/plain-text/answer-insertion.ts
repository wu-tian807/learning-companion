import { resolveTextRangeEndOffset } from '../../shared/workbench/text-range-anchor';
import type { DocumentConversationContext } from '../document-ai/document-conversation-context';
import type { PlainTextLineEnding } from './shared';

function normalizeLineEnding(
  text: string,
  lineEnding: PlainTextLineEnding,
): string {
  return lineEnding === 'crlf'
    ? text.replace(/\r?\n/gu, '\r\n')
    : text.replace(/\r\n/gu, '\n');
}

export function buildPlainTextAnswerBlock(
  text: string,
  lineEnding: PlainTextLineEnding = 'lf',
): string {
  const body = text.replace(/\s+$/u, '').split(/\r?\n/u);
  const block = ['[AI 回复]', ...body, '[/AI 回复]'].join('\n');
  return normalizeLineEnding(`\n${block}\n`, lineEnding);
}

export async function writePlainTextAnswerToSource(input: {
  readonly content: string;
  readonly context?: DocumentConversationContext;
  readonly text: string;
  readonly lineEnding: PlainTextLineEnding;
  readonly applyContent: (content: string) => void;
  readonly persistContent: (content: string) => Promise<void>;
}): Promise<string> {
  const offset = resolveTextRangeEndOffset(
    input.content,
    input.context?.target,
  );
  if (offset === undefined) {
    throw new Error('无法在原文中唯一定位选中位置，请重新选择内容后提问。');
  }
  const block = buildPlainTextAnswerBlock(input.text, input.lineEnding);
  const content =
    input.content.slice(0, offset) + block + input.content.slice(offset);
  input.applyContent(content);
  await input.persistContent(content);
  return content;
}
