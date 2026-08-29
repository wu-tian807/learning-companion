import { describe, expect, it } from 'vitest';

import type { ContentAnchorTarget } from './anchor';
import {
  createTextRangeTarget,
  resolveTextRangeEndOffset,
} from './text-range-anchor';

describe('Text range anchor', () => {
  it('captures offsets and quote context without leaking editor state', () => {
    expect(
      createTextRangeTarget('plain-text.text-range', '一二三四五', [
        { start: 1, end: 3 },
      ]),
    ).toEqual({
      scope: 'content',
      anchorType: 'plain-text.text-range',
      anchorVersion: 1,
      anchorPayload: {
        ranges: [
          {
            start: 1,
            end: 3,
            exact: '二三',
            prefix: '一',
            suffix: '四五',
          },
        ],
      },
    });
  });

  it('resolves the captured duplicate rather than the first matching quote', () => {
    const source = 'hello hello';
    const target = createTextRangeTarget('plain-text.text-range', source, [
      { start: 6, end: 11 },
    ]);

    expect(resolveTextRangeEndOffset(source, target)).toBe(11);
  });

  it('relocates a moved range only when quote context identifies one match', () => {
    const source = 'alpha one beta one gamma';
    const target = createTextRangeTarget('plain-text.text-range', source, [
      { start: 15, end: 18 },
    ]);

    expect(resolveTextRangeEndOffset(`new ${source}`, target)).toBe(22);
    expect(resolveTextRangeEndOffset('one one', target)).toBeUndefined();
    expect(resolveTextRangeEndOffset('quote removed', target)).toBeUndefined();
  });

  it('does not authorize source mutation from a visual-only quote', () => {
    const target: ContentAnchorTarget = {
      scope: 'content',
      anchorType: 'markdown.visual-selection',
      anchorVersion: 1,
      anchorPayload: { exact: 'hello' },
    };

    expect(resolveTextRangeEndOffset('[hello](url)', target)).toBeUndefined();
  });
});
