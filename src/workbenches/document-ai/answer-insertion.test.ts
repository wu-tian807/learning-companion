import { describe, expect, it } from 'vitest';

import { createDocumentConversationContext } from './document-conversation-context';
import {
  buildMarkdownAnswerBlock,
  buildPlainTextAnswerBlock,
  extractDocumentSelectionExact,
  findDocumentSelectionInsertOffset,
  insertAnswerBlockAtSelection,
} from './answer-insertion';

function rangeContext(exact: string, end: number) {
  return createDocumentConversationContext({
    target: {
      scope: 'content',
      anchorType: 'plain-text.text-range',
      anchorVersion: 1,
      anchorPayload: {
        ranges: [
          {
            start: 0,
            end,
            exact,
            prefix: '',
            suffix: '',
          },
        ],
      },
    },
    selectedText: exact,
  });
}

describe('document answer insertion helpers', () => {
  it('extracts the selected exact text from a range context', () => {
    expect(extractDocumentSelectionExact(rangeContext('hello', 5))).toBe(
      'hello',
    );
    expect(extractDocumentSelectionExact(undefined)).toBeUndefined();
  });

  it('finds the insertion offset after the selected text', () => {
    const content = '第一段内容。\n第二段内容。';
    const context = rangeContext('第一段内容', 5);
    expect(findDocumentSelectionInsertOffset(content, context)).toBe(5);

    // exact 找不到时回退到 ranges[0].end 源偏移
    const stale = rangeContext('已经不存在', 6);
    expect(findDocumentSelectionInsertOffset(content, stale)).toBe(6);

    expect(findDocumentSelectionInsertOffset(content, undefined)).toBeUndefined();
  });

  it('inserts the answer block right after the selected text', () => {
    const content = '第一段内容。\n第二段内容。';
    const context = rangeContext('第一段内容', 5);
    const inserted = insertAnswerBlockAtSelection({
      content,
      context,
      block: '[AI 回复]\n回答\n[/AI 回复]',
    });
    expect(inserted).toBe(
      '第一段内容[AI 回复]\n回答\n[/AI 回复]。\n第二段内容。',
    );

    expect(
      insertAnswerBlockAtSelection({
        content,
        context: undefined,
        block: '[AI 回复]',
      }),
    ).toBeUndefined();
  });

  it('builds a plain text block with bracket markers around the answer', () => {
    const block = buildPlainTextAnswerBlock('第一行\n第二行');
    expect(block).toContain('[AI 回复]');
    expect(block).toContain('[/AI 回复]');
    expect(block).toContain('第一行');
    expect(block).toContain('第二行');
    expect(block.startsWith('\n')).toBe(true);
    expect(block.endsWith('\n')).toBe(true);
  });

  it('builds a markdown block with bracket markers', () => {
    const block = buildMarkdownAnswerBlock('A < B & C > D');
    expect(block).toContain('[AI 回复]');
    expect(block).toContain('[/AI 回复]');
    expect(block).toContain('A < B & C > D');
  });

  it('normalizes CRLF for plain text blocks', () => {
    const block = buildPlainTextAnswerBlock('第一行', 'crlf');
    expect(block).toContain('\r\n');
    expect(block.match(/(?<!\r)\n/u)).toBeNull();
  });
});
