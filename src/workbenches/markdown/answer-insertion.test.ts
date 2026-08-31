import { describe, expect, it, vi } from 'vitest';

import { createDocumentConversationContext } from '../document-ai/document-conversation-context';
import {
  buildMarkdownAnswerBlock,
  writeMarkdownAnswerToSource,
} from './answer-insertion';

function formattedSelectionContext() {
  return createDocumentConversationContext({
    target: {
      scope: 'content',
      anchorType: 'markdown.visual-selection',
      anchorVersion: 1,
      anchorPayload: {
        exact: 'hello world',
        ranges: [{
          start: 0,
          end: 18,
          exact: '[hello](url) world',
          prefix: '',
          suffix: '',
        }],
      },
    },
    selectedText: 'hello world',
  });
}

describe('Markdown answer insertion', () => {
  it('owns the Markdown answer-block format', () => {
    expect(buildMarkdownAnswerBlock('A < B & C > D')).toBe(
      '\n[AI 回复]\nA < B & C > D\n[/AI 回复]\n',
    );
  });

  it('uses the captured Markdown source range instead of rendered text', async () => {
    const applyContent = vi.fn();
    const persistContent = vi.fn(async () => undefined);

    const content = await writeMarkdownAnswerToSource({
      content: '[hello](url) world',
      context: formattedSelectionContext(),
      text: '回答',
      lineEnding: 'lf',
      applyContent,
      persistContent,
    });

    expect(content).toBe(
      '[hello](url) world\n[AI 回复]\n回答\n[/AI 回复]\n',
    );
    expect(applyContent).toHaveBeenCalledWith(content);
    expect(persistContent).toHaveBeenCalledWith(content);
  });

  it('propagates persistence failure to the shared answer action', async () => {
    const applyContent = vi.fn();
    const persistContent = vi.fn(async () => {
      throw new Error('read only');
    });

    await expect(writeMarkdownAnswerToSource({
      content: '[hello](url) world',
      context: formattedSelectionContext(),
      text: '回答',
      lineEnding: 'lf',
      applyContent,
      persistContent,
    })).rejects.toThrow('read only');
    expect(applyContent).toHaveBeenCalledOnce();
  });

  it('refuses a visual quote that has no proven Markdown source range', async () => {
    const context = createDocumentConversationContext({
      target: {
        scope: 'content',
        anchorType: 'markdown.visual-selection',
        anchorVersion: 1,
        anchorPayload: { exact: 'hello' },
      },
      selectedText: 'hello',
    });

    await expect(writeMarkdownAnswerToSource({
      content: '[hello](url)',
      context,
      text: '回答',
      lineEnding: 'lf',
      applyContent: vi.fn(),
      persistContent: vi.fn(async () => undefined),
    })).rejects.toThrow('唯一定位');
  });
});
