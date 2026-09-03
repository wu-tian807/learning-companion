import { describe, expect, it } from 'vitest';

import type { ContentAssetTarget } from './asset-target';
import {
  createTextRangeTarget,
  isTextRangePayload,
  resolveTextRangeEndOffset,
} from './text-range-target';

describe('Text range anchor', () => {
  it('captures offsets and quote context without leaking editor state', () => {
    expect(
      createTextRangeTarget('plain-text.text-range', '一二三四五', [
        { start: 1, end: 3 },
      ]),
    ).toEqual({
      scope: 'content',
      targetType: 'plain-text.text-range',
      targetVersion: 1,
      targetPayload: {
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
    const target: ContentAssetTarget = {
      scope: 'content',
      targetType: 'markdown.visual-selection',
      targetVersion: 1,
      targetPayload: { exact: 'hello' },
    };

    expect(resolveTextRangeEndOffset('[hello](url)', target)).toBeUndefined();
  });

  it('rejects empty ranges that cannot be revealed', () => {
    expect(isTextRangePayload({
      ranges: [{ start: 2, end: 2, exact: '' }],
    })).toBe(false);
  });
});
