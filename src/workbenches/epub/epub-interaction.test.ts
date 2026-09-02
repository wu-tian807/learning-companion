import type { Contents } from 'epubjs';
import { describe, expect, it, vi } from 'vitest';

import {
  captureEpubSelectionSnapshot,
  createEpubSelectionSnapshot,
  resolveEpubContextMenuPosition,
} from './epub-interaction';

const cfiRange = 'epubcfi(/6/2!/4/2/1:0,/1:4)';

function createContents(): Contents {
  const startContainer = {} as Node;
  const endContainer = {} as Node;
  const selectedRange = {
    startContainer,
    startOffset: 0,
    endContainer,
    endOffset: 4,
    toString: () => '选中的 EPUB 文字',
  } as Range;
  const prefixRange = {
    selectNodeContents: vi.fn(),
    setEnd: vi.fn(),
    toString: () => '章节前文',
  };
  const suffixRange = {
    selectNodeContents: vi.fn(),
    setStart: vi.fn(),
    toString: () => '章节后文',
  };
  const document = {
    body: {},
    documentElement: {},
    createRange: vi
      .fn()
      .mockReturnValueOnce(prefixRange)
      .mockReturnValueOnce(suffixRange),
  };
  const frameElement = {
    getBoundingClientRect: () => ({
      left: 100.25,
      top: 200.5,
    }),
  };

  return {
    document,
    window: {
      frameElement,
      getSelection: () => ({
        rangeCount: 1,
        getRangeAt: () => selectedRange,
      }),
    },
    range: vi.fn(() => selectedRange),
    cfiFromRange: vi.fn(() => cfiRange),
  } as unknown as Contents;
}

describe('EPUB interaction helpers', () => {
  it('captures the live selection as a quote-backed CFI anchor', () => {
    const contents = createContents();
    const selection = captureEpubSelectionSnapshot(contents);

    expect(selection).toMatchObject({
      text: '选中的 EPUB 文字',
      target: {
        targetType: 'epub.cfi-range',
        targetPayload: {
          cfiRange,
          quote: {
            exact: '选中的 EPUB 文字',
            prefix: '章节前文',
            suffix: '章节后文',
          },
        },
      },
    });
  });

  it('returns no interaction for an invalid or empty CFI range', () => {
    const contents = createContents();
    vi.mocked(contents.range).mockImplementation(() => {
      throw new Error('invalid cfi');
    });

    expect(
      createEpubSelectionSnapshot(cfiRange, contents),
    ).toBeUndefined();
  });

  it('translates iframe-local context coordinates into app viewport coordinates', () => {
    expect(
      resolveEpubContextMenuPosition(
        { clientX: 20.4, clientY: 30.2 },
        createContents(),
      ),
    ).toEqual({ x: 121, y: 231 });
  });
});
