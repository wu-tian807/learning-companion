import { describe, expect, it, vi } from 'vitest';

import { createDocumentConversationContext } from '../document-ai/document-conversation-context';
import {
  buildPlainTextAnswerBlock,
  writePlainTextAnswerToSource,
} from './answer-insertion';

function contextAtSecondHello() {
  return createDocumentConversationContext({
    target: {
      scope: 'content',
      anchorType: 'plain-text.text-range',
      anchorVersion: 1,
      anchorPayload: {
        ranges: [{
          start: 6,
          end: 11,
          exact: 'hello',
          prefix: 'hello ',
          suffix: '',
        }],
      },
    },
    selectedText: 'hello',
  });
}

describe('Plain Text answer insertion', () => {
  it('owns the Plain Text bracket format and line endings', () => {
    const block = buildPlainTextAnswerBlock('第一行\n第二行', 'crlf');

    expect(block).toBe(
      '\r\n[AI 回复]\r\n第一行\r\n第二行\r\n[/AI 回复]\r\n',
    );
  });

  it('applies the insertion at the owned Anchor and waits for persistence', async () => {
    const applyContent = vi.fn();
    const persistContent = vi.fn(async () => undefined);

    const content = await writePlainTextAnswerToSource({
      content: 'hello hello',
      context: contextAtSecondHello(),
      text: '回答',
      lineEnding: 'lf',
      applyContent,
      persistContent,
    });

    expect(content).toBe(
      'hello hello\n[AI 回复]\n回答\n[/AI 回复]\n',
    );
    expect(applyContent).toHaveBeenCalledWith(content);
    expect(persistContent).toHaveBeenCalledWith(content);
  });

  it('rejects persistence failure while keeping the applied content dirty', async () => {
    const applyContent = vi.fn();
    const persistContent = vi.fn(async () => {
      throw new Error('disk full');
    });

    await expect(writePlainTextAnswerToSource({
      content: 'hello hello',
      context: contextAtSecondHello(),
      text: '回答',
      lineEnding: 'lf',
      applyContent,
      persistContent,
    })).rejects.toThrow('disk full');
    expect(applyContent).toHaveBeenCalledOnce();
  });
});
