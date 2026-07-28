import { describe, expect, it } from 'vitest';

import {
  createHtmlLinkTarget,
  createHtmlQuoteTarget,
  isHtmlLinkAnchorV1,
  isHtmlQuoteAnchorV1,
  isHtmlWorkbenchPayload,
} from './shared';

describe('HTML Workbench shared protocol', () => {
  it('accepts only scoped original-document URLs', () => {
    expect(
      isHtmlWorkbenchPayload({
        contentUrl: 'learning-content://resource/token',
      }),
    ).toBe(true);
    expect(
      isHtmlWorkbenchPayload({
        contentUrl: 'https://example.com',
      }),
    ).toBe(false);
  });

  it('creates quote-backed selection anchors from the isolated frame', () => {
    const target = createHtmlQuoteTarget(
      '正文内容',
      'learning-content://resource/token',
    );

    expect(isHtmlQuoteAnchorV1(target.anchorPayload)).toBe(true);
    expect(
      isHtmlQuoteAnchorV1({
        exact: '',
      }),
    ).toBe(false);
  });

  it('creates credential-free HTTP link anchors', () => {
    const target = createHtmlLinkTarget(
      'https://example.com/lesson',
    );

    expect(isHtmlLinkAnchorV1(target.anchorPayload)).toBe(true);
    expect(
      isHtmlLinkAnchorV1({
        url: 'javascript:alert(1)',
      }),
    ).toBe(false);
  });
});
