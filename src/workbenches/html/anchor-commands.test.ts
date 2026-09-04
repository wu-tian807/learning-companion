import { describe, expect, it } from 'vitest';

import { createHtmlDomTarget, createHtmlQuoteTarget } from './shared';
import {
  createAnchorClearCommand,
  createAnchorHighlightCommand,
  htmlAnchorCommands,
  isHtmlAnchorClearCommandPayload,
  isHtmlAnchorCommandResult,
  isHtmlAnchorHighlightCommandPayload,
  isHtmlAnchorTarget,
  isSameHtmlAnchorLocation,
} from './anchor-commands';

describe('HTML anchor commands', () => {
  it('accepts validated HTML targets and bounded highlight options', () => {
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element: { path: [1], tagName: 'p', textQuote: '锚点正文' },
    });

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
    expect(createAnchorHighlightCommand(target, 1, true, 2_800)).toMatchObject({
      type: htmlAnchorCommands.highlight,
    });
    expect(createAnchorClearCommand(target, 2)).toMatchObject({
      type: htmlAnchorCommands.clear,
    });
  });

  it('rejects malformed anchors and unbounded lifecycle values', () => {
    expect(
      isHtmlAnchorHighlightCommandPayload({
        target: { targetType: 'html.quote' },
        revision: 0,
        reveal: true,
        durationMs: 2_800,
      }),
    ).toBe(false);
    expect(
      isHtmlAnchorHighlightCommandPayload({
        target: createHtmlDomTarget({
          frameUrl: 'learning-content://resource/token',
          element: { tagName: 'div', path: [0] },
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

  it('treats the same DOM element as the same location after responsive reflow', () => {
    const anchor = (path: readonly number[]) => createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element: { path, tagName: 'p', textQuote: '选中正文' },
    });
    const selected = anchor([1, 0]);
    const sameSelection = anchor([1, 0]);
    const otherOccurrence = anchor([1, 1]);

    expect(isSameHtmlAnchorLocation(selected, sameSelection)).toBe(true);
    expect(isSameHtmlAnchorLocation(selected, otherOccurrence)).toBe(false);
  });

  it('keeps comparing legacy quote ranges during compatibility reads', () => {
    const locator = {
      domRange: {
        start: { path: [1, 0, 0], offset: 0 },
        end: { path: [1, 0, 0], offset: 4 },
      },
    } as const;
    expect(
      isSameHtmlAnchorLocation(
        createHtmlQuoteTarget('选中正文', undefined, undefined, locator),
        createHtmlQuoteTarget('选中正文', undefined, undefined, locator),
      ),
    ).toBe(true);
  });
});
