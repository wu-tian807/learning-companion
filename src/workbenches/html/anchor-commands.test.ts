import { describe, expect, it } from 'vitest';

import { createHtmlElementTarget, createHtmlQuoteTarget } from './shared';
import {
  isHtmlAnchorClearCommandPayload,
  isHtmlAnchorCommandResult,
  isHtmlAnchorHighlightCommandPayload,
  isHtmlAnchorTarget,
  isSameHtmlQuoteLocation,
} from './anchor-commands';

describe('HTML anchor commands', () => {
  it('accepts validated HTML targets and bounded highlight options', () => {
    const target = createHtmlQuoteTarget('锚点正文');

    expect(isHtmlAnchorTarget(target)).toBe(true);
    expect(
      isHtmlAnchorHighlightCommandPayload({
        target,
        revision: 1,
        reveal: true,
        durationMs: 2_800,
      }),
    ).toBe(true);
    expect(
      isHtmlAnchorClearCommandPayload({ target, revision: 1 }),
    ).toBe(true);
    expect(isHtmlAnchorCommandResult({ found: true })).toBe(true);
  });

  it('rejects malformed anchors and unbounded lifecycle values', () => {
    expect(
      isHtmlAnchorHighlightCommandPayload({
        target: { anchorType: 'html.quote' },
        revision: 0,
        reveal: true,
        durationMs: 2_800,
      }),
    ).toBe(false);
    expect(
      isHtmlAnchorHighlightCommandPayload({
        target: createHtmlElementTarget({
          frameUrl: 'learning-content://resource/token',
          tagName: 'div',
          domPath: [0],
          rect: { x: 0, y: 0, width: 10, height: 10 },
        }),
        revision: 1,
        reveal: false,
        durationMs: 60_001,
      }),
    ).toBe(false);
    expect(
      isHtmlAnchorClearCommandPayload({
        target: createHtmlQuoteTarget('锚点正文'),
        revision: -1,
      }),
    ).toBe(false);
    expect(isHtmlAnchorCommandResult({ found: 'yes' })).toBe(false);
  });

  it('treats a consumed quote as the same location after responsive reflow', () => {
    const locator = {
      domRange: {
        start: { path: [1, 0, 0], offset: 0 },
        end: { path: [1, 0, 0], offset: 4 },
      },
    } as const;
    const wide = createHtmlQuoteTarget(
      '选中正文',
      'learning-content://resource/token',
      { x: 320, y: 90, width: 240, height: 18 },
      locator,
    );
    const narrow = createHtmlQuoteTarget(
      '选中正文',
      'learning-content://resource/token',
      { x: 20, y: 210, width: 90, height: 72 },
      locator,
    );
    const otherOccurrence = createHtmlQuoteTarget(
      '选中正文',
      'learning-content://resource/token',
      { x: 20, y: 420, width: 90, height: 72 },
      {
        ...locator,
        domRange: {
          start: { path: [1, 1, 0], offset: 0 },
          end: { path: [1, 1, 0], offset: 4 },
        },
      },
    );

    expect(isSameHtmlQuoteLocation(wide, narrow)).toBe(true);
    expect(isSameHtmlQuoteLocation(wide, otherOccurrence)).toBe(false);
    expect(
      isSameHtmlQuoteLocation(
        createHtmlQuoteTarget('选中正文'),
        createHtmlQuoteTarget('选中正文'),
      ),
    ).toBe(false);
  });
});
