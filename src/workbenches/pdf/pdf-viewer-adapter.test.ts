import { describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist', () => ({
  AnnotationMode: { ENABLE: 1 },
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
  InvalidPDFException: class InvalidPDFException extends Error {},
  PasswordResponses: {
    NEED_PASSWORD: 1,
    INCORRECT_PASSWORD: 2,
  },
}));

vi.mock('pdfjs-dist/web/pdf_viewer.mjs', () => ({
  EventBus: class EventBus {},
  FindState: {
    FOUND: 0,
    NOT_FOUND: 1,
    WRAPPED: 2,
    PENDING: 3,
  },
  PDFFindController: class PDFFindController {},
  PDFLinkService: class PDFLinkService {
    setViewer() {}
    setDocument() {}
  },
  PDFViewer: class PDFViewer {},
  ScrollMode: { VERTICAL: 0, PAGE: 3 },
}));

import {
  createPdfDocumentLoadingParameters,
  createPdfSelectionSnapshotFromSegments,
  isSafePdfExternalUrl,
  normalizePdfSelectionText,
  resolvePdfAssetUrls,
  shouldClearCollapsedPdfSelection,
} from './pdf-viewer-adapter';

const identity = {
  fingerprint: 'pdf-document',
  modifiedFingerprint: 'revision-1',
};

describe('PDF selection indexing', () => {
  it('keeps offsets in JavaScript UTF-16 code units', () => {
    const pageText = '甲😀乙选中文字丙';
    const snapshot = createPdfSelectionSnapshotFromSegments(
      identity,
      [
        {
          pageNumber: 1,
          pageText,
          startOffset: '甲😀乙'.length,
          endOffset: '甲😀乙选中文字'.length,
        },
      ],
      '选中文字',
      'continuous',
    );

    expect(snapshot?.target.anchorPayload).toMatchObject({
      start: { pageNumber: 1, offset: 4 },
      end: { pageNumber: 1, offset: 8 },
      quote: {
        exact: '选中文字',
        prefix: '甲😀乙',
        suffix: '丙',
      },
    });
  });

  it('creates a cross-page range joined by a single newline', () => {
    const snapshot = createPdfSelectionSnapshotFromSegments(
      identity,
      [
        {
          pageNumber: 2,
          pageText: '第一页尾部',
          startOffset: 3,
          endOffset: 5,
        },
        {
          pageNumber: 3,
          pageText: '第二页开头',
          startOffset: 0,
          endOffset: 3,
        },
      ],
      '尾部\n第二页',
      'continuous',
    );

    expect(snapshot).toMatchObject({
      text: '尾部\n第二页',
      target: {
        anchorPayload: {
          start: { pageNumber: 2, offset: 3 },
          end: { pageNumber: 3, offset: 3 },
        },
      },
    });
  });

  it('allows whitespace rendering differences but rejects wrong mappings', () => {
    expect(
      normalizePdfSelectionText('  第一页\n\n 第二页  '),
    ).toBe('第一页 第二页');
    expect(
      createPdfSelectionSnapshotFromSegments(
        identity,
        [
          {
            pageNumber: 1,
            pageText: '正确文本',
            startOffset: 0,
            endOffset: 4,
          },
        ],
        '另一文本',
        'continuous',
      ),
    ).toBeUndefined();
  });

  it('does not create cross-page anchors in paged mode', () => {
    expect(
      createPdfSelectionSnapshotFromSegments(
        identity,
        [
          {
            pageNumber: 1,
            pageText: '第一页',
            startOffset: 0,
            endOffset: 3,
          },
          {
            pageNumber: 2,
            pageText: '第二页',
            startOffset: 0,
            endOffset: 3,
          },
        ],
        '第一页\n第二页',
        'paged',
      ),
    ).toBeUndefined();
  });
});

describe('PDF local asset URLs', () => {
  it('resolves every runtime resource relative to the renderer document', () => {
    expect(
      resolvePdfAssetUrls('file:///Applications/Learning/index.html'),
    ).toEqual({
      workerSrc:
        'file:///Applications/Learning/vendor/pdfjs/pdf.worker.min.mjs',
      cMapUrl:
        'file:///Applications/Learning/vendor/pdfjs/cmaps/',
      standardFontDataUrl:
        'file:///Applications/Learning/vendor/pdfjs/standard_fonts/',
      wasmUrl:
        'file:///Applications/Learning/vendor/pdfjs/wasm/',
      iccUrl:
        'file:///Applications/Learning/vendor/pdfjs/iccs/',
      imageResourcesPath:
        'file:///Applications/Learning/vendor/pdfjs/images/',
    });
  });

  it('keeps file-backed helper resources out of worker fetch', () => {
    const assetUrls = resolvePdfAssetUrls(
      'file:///Applications/Learning/index.html',
    );

    expect(
      createPdfDocumentLoadingParameters(
        'learning-content://resource/token',
        assetUrls,
      ),
    ).toMatchObject({
      url: 'learning-content://resource/token',
      useWorkerFetch: false,
      disableRange: true,
      cMapUrl:
        'file:///Applications/Learning/vendor/pdfjs/cmaps/',
    });
  });

  it('retains a valid PDF selection when focus moves outside the viewer', () => {
    expect(shouldClearCollapsedPdfSelection(true, false)).toBe(false);
    expect(shouldClearCollapsedPdfSelection(true, true)).toBe(true);
    expect(shouldClearCollapsedPdfSelection(false, true)).toBe(false);
  });

  it('accepts only credential-free HTTP(S) links', () => {
    expect(isSafePdfExternalUrl('https://example.com/lesson')).toBe(
      true,
    );
    expect(isSafePdfExternalUrl('http://example.com/lesson')).toBe(
      true,
    );
    expect(
      isSafePdfExternalUrl('https://user:secret@example.com/lesson'),
    ).toBe(false);
    expect(isSafePdfExternalUrl('file:///tmp/private.pdf')).toBe(
      false,
    );
    expect(isSafePdfExternalUrl('javascript:alert(1)')).toBe(false);
  });
});
