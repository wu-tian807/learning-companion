import { describe, expect, it } from 'vitest';

import { createHtmlDomTarget, createHtmlQuoteTarget } from './shared';
import {
  isHtmlEditIndicatorClearCommandPayload,
  isHtmlEditIndicatorShowCommandPayload,
} from './html-edit-indicator-commands';

const target = createHtmlDomTarget({
  frameUrl: 'learning-content://resource/html',
  element: { path: [1], tagName: 'p' },
});

describe('HTML edit indicator commands', () => {
  it('accepts bounded DOM-target show and clear payloads', () => {
    expect(
      isHtmlEditIndicatorShowCommandPayload({
        target,
        revision: 1,
        phase: 'editing',
      }),
    ).toBe(true);
    expect(
      isHtmlEditIndicatorClearCommandPayload({ target, revision: 1 }),
    ).toBe(true);
  });

  it('rejects history anchors, invalid phases, and extra keys', () => {
    expect(
      isHtmlEditIndicatorShowCommandPayload({
        target: createHtmlQuoteTarget('history'),
        revision: 1,
        phase: 'editing',
      }),
    ).toBe(false);
    expect(
      isHtmlEditIndicatorShowCommandPayload({
        target,
        revision: 1,
        phase: 'done',
      }),
    ).toBe(false);
    expect(
      isHtmlEditIndicatorClearCommandPayload({
        target,
        revision: 1,
        extra: true,
      }),
    ).toBe(false);
  });
});
