import { describe, expect, it } from 'vitest';

import {
  createHtmlDomTarget,
  createHtmlLinkTarget,
  createHtmlElementTarget,
  createHtmlQuoteTarget,
  isHtmlDraftReview,
  isHtmlDomAnchorV1,
  isHtmlDomTarget,
  isHtmlLinkAnchorV1,
  isHtmlElementAnchorV1,
  isHtmlElementTarget,
  isHtmlQuoteAnchorV1,
  isHtmlWorkbenchPayload,
} from './shared';

describe('HTML Workbench shared protocol', () => {
  it('accepts a review of every source region allowed by the editor', () => {
    const maximumRegion = 'a'.repeat(2_097_152);
    const review = {
      entries: [
        {
          taskId: 'task-1',
          changes: [{ before: maximumRegion, after: '<p>shorter</p>' }],
        },
      ],
      pendingChanges: [],
    };

    expect(isHtmlDraftReview(review)).toBe(true);
    expect(
      isHtmlDraftReview({
        ...review,
        entries: [
          {
            taskId: 'task-1',
            changes: [{ before: `${maximumRegion}a`, after: '' }],
          },
        ],
      }),
    ).toBe(false);
  });

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
    expect(
      isHtmlWorkbenchPayload({
        contentUrl: 'learning-content://resource/token',
        editing: {
          editable: true,
          hasDraft: true,
          unsynced: true,
          syncRequested: false,
          pending: false,
          stepCount: 1,
          changeCount: 2,
          canUndo: true,
          canRedo: false,
          conflict: null,
          draftRevision: 'revision-1',
        },
      }),
    ).toBe(true);
    expect(
      isHtmlWorkbenchPayload({
        contentUrl: 'learning-content://resource/token',
        editing: {
          editable: true,
          hasDraft: true,
          unsynced: true,
          syncRequested: false,
          pending: false,
          stepCount: -1,
          changeCount: 2,
          canUndo: true,
          canRedo: false,
          conflict: null,
          draftRevision: '',
        },
      }),
    ).toBe(false);
  });

  it('uses the same element-only DOM anchor for click and drag selection', () => {
    const element = {
      path: [1, 3, 0],
      tagName: 'section',
      id: 'chapter',
      textQuote: '章节正文',
    } as const;
    const wholeElement = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element,
    });
    const dragSelection = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element,
    });

    expect(isHtmlDomTarget(wholeElement)).toBe(true);
    expect(isHtmlDomTarget(dragSelection)).toBe(true);
    expect(dragSelection).toEqual(wholeElement);
    expect(isHtmlDomAnchorV1(dragSelection.anchorPayload)).toBe(true);
    expect(dragSelection.anchorPayload).not.toHaveProperty('rect');
    expect(dragSelection.anchorPayload).not.toHaveProperty('range');
    expect(
      isHtmlDomAnchorV1({
        frameUrl: 'learning-content://resource/token',
        element,
        range: { exact: '章节' },
      }),
    ).toBe(false);
  });

  it('omits the session-local URL for a root document anchor', () => {
    const target = createHtmlDomTarget({
      element: { path: [1], tagName: 'main', textQuote: '正文' },
    });

    expect(isHtmlDomTarget(target)).toBe(true);
    expect(target.anchorPayload).not.toHaveProperty('frameUrl');
  });

  it('keeps validating legacy quote anchors for persisted conversations', () => {
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
