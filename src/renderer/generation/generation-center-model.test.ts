import { describe, expect, it } from 'vitest';

import { summarizeSelection } from './generation-center-model';

describe('Generation center model', () => {
  it('normalizes a selection into a compact summary', () => {
    expect(summarizeSelection('第一行\n\n第二行')).toEqual({
      characterCount: 8,
      preview: '第一行 第二行',
    });
  });

  it('counts Unicode characters instead of UTF-16 code units', () => {
    expect(summarizeSelection('A📘中').characterCount).toBe(3);
  });
});
