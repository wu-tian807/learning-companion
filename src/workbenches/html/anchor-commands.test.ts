import { describe, expect, it } from 'vitest';

import { createHtmlElementTarget, createHtmlQuoteTarget } from './shared';
import {
  isHtmlAnchorClearCommandPayload,
  isHtmlAnchorCommandResult,
  isHtmlAnchorHighlightCommandPayload,
  isHtmlAnchorTarget,
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
});
