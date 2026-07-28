import { describe, expect, it } from 'vitest';

import {
  createEpubCfiRangeTarget,
  DEFAULT_EPUB_VIEW_STATE,
  epubWorkbenchManifest,
  isEpubCfiRangeAnchorV1,
  isEpubWorkbenchPayload,
  isEpubWorkbenchViewState,
} from './shared';

describe('EPUB Workbench shared protocol', () => {
  it('declares EPUB stream support and CFI anchors', () => {
    expect(epubWorkbenchManifest.supportedMediaTypes).toEqual([
      'application/epub+zip',
    ]);
    expect(epubWorkbenchManifest.supportedAnchorTypes).toEqual([
      'epub.cfi-range',
    ]);
  });

  it('validates bootstrap and constrained reader state', () => {
    expect(isEpubWorkbenchViewState(DEFAULT_EPUB_VIEW_STATE)).toBe(true);
    expect(
      isEpubWorkbenchPayload({
        contentUrl: 'learning-content://resource/epub',
        viewState: {
          ...DEFAULT_EPUB_VIEW_STATE,
          location: 'epubcfi(/6/2!/4/2/1:0)',
        },
      }),
    ).toBe(true);
    expect(
      isEpubWorkbenchViewState({
        ...DEFAULT_EPUB_VIEW_STATE,
        location: 'javascript:alert(1)',
      }),
    ).toBe(false);
  });

  it('creates a quote-backed CFI range target', () => {
    const anchor = {
      cfiRange: 'epubcfi(/6/2!/4/2/1:0,/1:0,/1:4)',
      quote: {
        exact: '正文',
        prefix: '前文',
        suffix: '后文',
      },
    };
    const target = createEpubCfiRangeTarget(anchor);

    expect(isEpubCfiRangeAnchorV1(target.anchorPayload)).toBe(true);
  });
});
