import { describe, expect, it } from 'vitest';

import { normalizeAiMarkdown } from './ai-markdown';

describe('normalizeAiMarkdown', () => {
  it('normalizes inline and display LaTeX delimiters from AI answers', () => {
    expect(
      normalizeAiMarkdown(
        String.raw`**重点**：离 \(x\) 越近。\[f(x)=\sum_{i=1}^n y_i\]`,
      ),
    ).toBe('**重点**：离 $x$ 越近。\n$$\nf(x)=\\sum_{i=1}^n y_i\n$$\n');
  });
});
