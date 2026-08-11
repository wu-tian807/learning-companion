import { describe, expect, it } from 'vitest';

import {
  normalizeAiMarkdown,
  normalizeSelectedAnswerText,
} from './ai-markdown';

describe('normalizeAiMarkdown', () => {
  it('normalizes inline and display LaTeX delimiters from AI answers', () => {
    expect(
      normalizeAiMarkdown(
        String.raw`**重点**：离 \(x\) 越近。\[f(x)=\sum_{i=1}^n y_i\]`,
      ),
    ).toBe('**重点**：离 $x$ 越近。\n$$\nf(x)=\\sum_{i=1}^n y_i\n$$\n');
  });

  it('removes presentation-only line breaks from a rendered formula selection', () => {
    expect(
      normalizeSelectedAnswerText('CNN:\n\nO\n(\nk\nL\nd\n2\n)\nO(kLd\n2\n)'),
    ).toBe('CNN:\n\nO ( k L d 2 ) O(kLd 2 )');
  });
});
