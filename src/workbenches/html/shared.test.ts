import { describe, expect, it } from 'vitest';

import {
  createHtmlLinkTarget,
  createHtmlElementTarget,
  createHtmlQuoteTarget,
  isHtmlLinkAnchorV1,
  isHtmlElementAnchorV1,
  isHtmlElementTarget,
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
      { x: 10, y: 20, width: 80, height: 18 },
      {
        domRange: {
          start: { path: [1, 0, 0], offset: 2 },
          end: { path: [1, 0, 0], offset: 6 },
        },
      },
    );

    expect(isHtmlQuoteAnchorV1(target.anchorPayload)).toBe(true);
    expect(
      isHtmlQuoteAnchorV1({
        exact: '',
      }),
    ).toBe(false);
    expect(
      isHtmlQuoteAnchorV1({
        exact: '正文内容',
        domRange: {
          start: { path: [1, -1], offset: 0 },
          end: { path: [1, 0], offset: 4 },
        },
      }),
    ).toBe(false);
    expect(
      isHtmlQuoteAnchorV1({
        exact: '正文内容',
        domRange: {
          start: { path: [1, 0], offset: 0 },
        },
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

  it('keeps a bounded DOM path for Workbench-owned element location', () => {
    const target = createHtmlElementTarget({
      frameUrl: 'learning-content://resource/token',
      tagName: 'div',
      domPath: [1, 3, 0],
      rect: { x: 10, y: 20, width: 100, height: 30 },
      id: 'chapter',
      textQuote: '章节正文',
    });

    expect(isHtmlElementTarget(target)).toBe(true);
    expect(isHtmlElementAnchorV1(target.anchorPayload)).toBe(true);
    expect(
      isHtmlElementAnchorV1({
        frameUrl: 'learning-content://resource/token',
        tagName: 'DIV',
        domPath: [1],
      }),
    ).toBe(false);
  });
});
