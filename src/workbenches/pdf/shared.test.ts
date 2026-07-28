import { describe, expect, it } from 'vitest';

import {
  createPdfDocumentIdentity,
  createPdfPageTarget,
  createPdfSaveViewStateCommand,
  createPdfTextRangeAnchor,
  createPdfTextRangeTarget,
  DEFAULT_PDF_WORKBENCH_STATE,
  isPdfDocumentIdentity,
  isPdfPageAnchorV1,
  isPdfSaveViewStatePayload,
  isPdfSaveViewStateResult,
  isPdfTextRangeAnchorV1,
  isPdfWorkbenchPayload,
  isPdfWorkbenchStateV1,
  matchesPdfDocumentIdentity,
  pdfCommands,
  pdfWorkbenchManifest,
} from './shared';

describe('PDF Workbench shared protocol', () => {
  it('declares the PDF media type, stream capability, and text anchor', () => {
    expect(pdfWorkbenchManifest.supportedMediaTypes).toEqual([
      'application/pdf',
    ]);
    expect(pdfWorkbenchManifest.requiredContentCapabilities).toEqual([
      'read-stream',
    ]);
    expect(pdfWorkbenchManifest.supportedAnchorTypes).toEqual([
      'pdf.text-range',
      'pdf.page',
    ]);
  });

  it('validates bootstrap and persisted reading state', () => {
    expect(isPdfWorkbenchStateV1(DEFAULT_PDF_WORKBENCH_STATE)).toBe(true);
    expect(
      isPdfWorkbenchPayload({
        contentUrl: 'learning-content://resource/token',
        viewState: {
          readingMode: 'paged',
          pageNumber: 12,
          pageOffsetRatio: 0.5,
          scaleMode: 'custom',
          customScale: 1.25,
          rotation: 270,
          sidebar: 'outline',
        },
      }),
    ).toBe(true);
  });

  it('rejects unsafe URLs and invalid reading state', () => {
    expect(
      isPdfWorkbenchPayload({
        contentUrl: 'file:///Users/example/private.pdf',
        viewState: DEFAULT_PDF_WORKBENCH_STATE,
      }),
    ).toBe(false);
    expect(
      isPdfWorkbenchStateV1({
        ...DEFAULT_PDF_WORKBENCH_STATE,
        pageNumber: 0,
      }),
    ).toBe(false);
    expect(
      isPdfWorkbenchStateV1({
        ...DEFAULT_PDF_WORKBENCH_STATE,
        pageOffsetRatio: 1.01,
      }),
    ).toBe(false);
    expect(
      isPdfWorkbenchStateV1({
        ...DEFAULT_PDF_WORKBENCH_STATE,
        rotation: 45,
      }),
    ).toBe(false);
  });

  it('creates and validates save-view-state commands', () => {
    const viewState = {
      ...DEFAULT_PDF_WORKBENCH_STATE,
      pageNumber: 8,
      scaleMode: 'custom' as const,
      customScale: 1.5,
    };
    const command = createPdfSaveViewStateCommand(viewState);

    expect(command.type).toBe(pdfCommands.saveViewState);
    expect(isPdfSaveViewStatePayload(command.payload)).toBe(true);
    expect(
      isPdfSaveViewStateResult({ saved: true, savedTime: 100 }),
    ).toBe(true);
  });
});

describe('PDF text range anchor', () => {
  it('creates a current-page target for page-scoped actions', () => {
    const target = createPdfPageTarget(7);

    expect(target).toEqual({
      scope: 'content',
      anchorType: 'pdf.page',
      anchorVersion: 1,
      anchorPayload: { pageNumber: 7 },
    });
    expect(isPdfPageAnchorV1(target.anchorPayload)).toBe(true);
    expect(isPdfPageAnchorV1({ pageNumber: 0 })).toBe(false);
  });

  it('normalizes PDF.js fingerprints into a stable document identity', () => {
    expect(createPdfDocumentIdentity(['original', null])).toEqual({
      fingerprint: 'original',
    });
    expect(createPdfDocumentIdentity(['original', 'modified'])).toEqual({
      fingerprint: 'original',
      modifiedFingerprint: 'modified',
    });
    expect(
      isPdfDocumentIdentity({
        fingerprint: 'original',
        modifiedFingerprint: 'modified',
      }),
    ).toBe(true);
  });

  it('creates a versioned UTF-16 text range target', () => {
    const identity = createPdfDocumentIdentity([
      'document-fingerprint',
      null,
    ]);
    const anchor = createPdfTextRangeAnchor({
      documentIdentity: identity,
      start: { pageNumber: 2, offset: 3 },
      end: { pageNumber: 3, offset: 5 },
      quote: {
        exact: '😀跨页内容',
        prefix: '前文',
        suffix: '后文',
      },
    });

    expect(isPdfTextRangeAnchorV1(anchor)).toBe(true);
    expect(createPdfTextRangeTarget(anchor)).toEqual({
      scope: 'content',
      anchorType: 'pdf.text-range',
      anchorVersion: 1,
      anchorPayload: anchor,
    });
  });

  it('rejects reversed, empty, and malformed ranges', () => {
    const base = {
      documentIdentity: { fingerprint: 'document' },
      start: { pageNumber: 3, offset: 2 },
      end: { pageNumber: 2, offset: 9 },
      quote: { exact: '内容', prefix: '', suffix: '' },
    };

    expect(isPdfTextRangeAnchorV1(base)).toBe(false);
    expect(
      isPdfTextRangeAnchorV1({
        ...base,
        start: { pageNumber: 2, offset: 2 },
        end: { pageNumber: 2, offset: 2 },
      }),
    ).toBe(false);
    expect(
      isPdfTextRangeAnchorV1({
        ...base,
        start: { pageNumber: 2, offset: 2 },
        end: { pageNumber: 2, offset: 4 },
        quote: { exact: '', prefix: '', suffix: '' },
      }),
    ).toBe(false);
  });

  it('requires exact fingerprint identity before resolving an anchor', () => {
    const anchor = createPdfTextRangeAnchor({
      documentIdentity: {
        fingerprint: 'original',
        modifiedFingerprint: 'revision-a',
      },
      start: { pageNumber: 1, offset: 0 },
      end: { pageNumber: 1, offset: 2 },
      quote: { exact: '正文', prefix: '', suffix: '' },
    });

    expect(
      matchesPdfDocumentIdentity(anchor, {
        fingerprint: 'original',
        modifiedFingerprint: 'revision-a',
      }),
    ).toBe(true);
    expect(
      matchesPdfDocumentIdentity(anchor, {
        fingerprint: 'original',
        modifiedFingerprint: 'revision-b',
      }),
    ).toBe(false);
    expect(
      matchesPdfDocumentIdentity(anchor, {
        fingerprint: 'other-document',
        modifiedFingerprint: 'revision-a',
      }),
    ).toBe(false);
  });
});
