import type { Contents } from 'epubjs';

import type { WorkbenchSelectionSnapshot } from '../../shared/workbench/selection';
import {
  createEpubCfiRangeTarget,
  type EpubCfiRangeAnchorV1,
} from './shared';

function createCfiSelectionAnchor(
  cfiRange: string,
  contents: Contents,
): EpubCfiRangeAnchorV1 | undefined {
  let range: Range;

  try {
    range = contents.range(cfiRange);
  } catch {
    return undefined;
  }

  const exact = range.toString();
  if (!exact.trim() || exact.length > 16_384) {
    return undefined;
  }

  const root =
    contents.document.body ?? contents.document.documentElement;
  const prefixRange = contents.document.createRange();
  prefixRange.selectNodeContents(root);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  const suffixRange = contents.document.createRange();
  suffixRange.selectNodeContents(root);
  suffixRange.setStart(range.endContainer, range.endOffset);

  return {
    cfiRange,
    quote: {
      exact,
      prefix: prefixRange.toString().slice(-128),
      suffix: suffixRange.toString().slice(0, 128),
    },
  };
}

export function createEpubSelectionSnapshot(
  cfiRange: string,
  contents: Contents,
): WorkbenchSelectionSnapshot | undefined {
  const anchor = createCfiSelectionAnchor(cfiRange, contents);

  return anchor
    ? {
        text: anchor.quote.exact,
        target: createEpubCfiRangeTarget(anchor),
      }
    : undefined;
}

export function captureEpubSelectionSnapshot(
  contents: Contents,
): WorkbenchSelectionSnapshot | undefined {
  const selection = contents.window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return undefined;
  }

  try {
    const range = selection.getRangeAt(0);

    return createEpubSelectionSnapshot(
      contents.cfiFromRange(range),
      contents,
    );
  } catch {
    return undefined;
  }
}

export function resolveEpubContextMenuPosition(
  event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  contents: Contents,
): { readonly x: number; readonly y: number } {
  const frame = contents.window.frameElement;
  const bounds = frame?.getBoundingClientRect();

  return {
    x: Math.max(
      0,
      Math.round((bounds?.left ?? 0) + event.clientX),
    ),
    y: Math.max(
      0,
      Math.round((bounds?.top ?? 0) + event.clientY),
    ),
  };
}
