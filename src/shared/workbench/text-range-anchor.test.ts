import { describe, expect, it } from 'vitest';

import { createTextRangeTarget } from './text-range-anchor';

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
});
