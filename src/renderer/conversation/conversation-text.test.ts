import { describe, expect, it } from 'vitest';

import {
  normalizeConversationMarkdown,
  normalizeConversationSelection,
} from './conversation-text';

describe('Conversation text normalization', () => {
  it('normalizes common LaTeX delimiters for the Markdown renderer', () => {
    expect(normalizeConversationMarkdown('行内 \\(x^2\\)，块级：\\[y=1\\]'))
      .toBe('行内 $x^2$，块级：\n$$\ny=1\n$$\n');
  });

  it('joins wrapped lines while preserving paragraph boundaries', () => {
    expect(normalizeConversationSelection('第一行\n 第二行\n\n第三段'))
      .toBe('第一行 第二行\n\n第三段');
  });
});
