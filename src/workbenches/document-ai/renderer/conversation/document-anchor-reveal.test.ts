// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContentAnchorTarget } from '../../../../shared/workbench/anchor';
import { createTextRangeTarget } from '../../../../shared/workbench/text-range-anchor';
import {
  resolveTextSelectionFromTarget,
  revealSelectionInCodeMirror,
  scrollRangeIntoView,
  selectOffsetsInElement,
  selectTextInElement,
} from './document-anchor-reveal';

const RANGE_ANCHOR_TYPE = 'test.text-range';

afterEach(() => {
  vi.restoreAllMocks();
});

function rangeTarget(
  source: string,
  start: number,
  end: number,
): ContentAnchorTarget {
  return createTextRangeTarget(
    RANGE_ANCHOR_TYPE,
    source,
    [{ start, end }],
  );
}

describe('resolveTextSelectionFromTarget', () => {
  it('resolves offsets and the exact quoted text from a text-range anchor', () => {
    const target = rangeTarget('你好，世界 hello world', 3, 8);

    expect(
      resolveTextSelectionFromTarget(target, [RANGE_ANCHOR_TYPE]),
    ).toEqual({
      start: 3,
      end: 8,
      exact: '世界 he',
    });
  });

  it('ignores anchors of other types', () => {
    const target = rangeTarget('hello', 0, 2);

    expect(
      resolveTextSelectionFromTarget(target, ['other.type']),
    ).toBeUndefined();
  });

  it('ignores anchors whose payload is not a text range', () => {
    const target: ContentAnchorTarget = {
      scope: 'content',
      anchorType: RANGE_ANCHOR_TYPE,
      anchorVersion: 1,
      anchorPayload: { pageNumber: 1, x: 0, y: 0, width: 0.2, height: 0.2 },
    };

    expect(
      resolveTextSelectionFromTarget(target, [RANGE_ANCHOR_TYPE]),
    ).toBeUndefined();
  });

  it('ignores collapsed ranges and omits blank exact text', () => {
    const collapsed = rangeTarget('hello', 2, 2);
    const blankExact = {
      scope: 'content',
      anchorType: RANGE_ANCHOR_TYPE,
      anchorVersion: 1,
      anchorPayload: {
        ranges: [{ start: 1, end: 3, exact: '   ' }],
      },
    } as const;

    expect(
      resolveTextSelectionFromTarget(collapsed, [RANGE_ANCHOR_TYPE]),
    ).toBeUndefined();
    expect(
      resolveTextSelectionFromTarget(blankExact, [RANGE_ANCHOR_TYPE]),
    ).toEqual({ start: 1, end: 3 });
  });
});

describe('selectOffsetsInElement', () => {
  it('selects the matching substring in a single text node', () => {
    const element = document.createElement('div');
    element.textContent = '你好，世界 hello';
    const addRange = vi.spyOn(window.Selection.prototype, 'addRange');

    expect(selectOffsetsInElement(element, 3, 5)).toBe(true);

    expect(addRange).toHaveBeenCalledTimes(1);
    const range = addRange.mock.calls[0]?.[0] as Range;
    expect(range.toString()).toBe('世界');
  });

  it('clamps offsets to the text length', () => {
    const element = document.createElement('div');
    element.textContent = 'hello';
    const addRange = vi.spyOn(window.Selection.prototype, 'addRange');

    expect(selectOffsetsInElement(element, -2, 99)).toBe(true);
    const range = addRange.mock.calls[0]?.[0] as Range;
    expect(range.toString()).toBe('hello');
  });

  it('returns false when there is no selectable text node', () => {
    const element = document.createElement('div');
    element.appendChild(document.createElement('span'));

    expect(selectOffsetsInElement(element, 0, 1)).toBe(false);
  });
});

describe('selectTextInElement', () => {
  it('selects text split across multiple text nodes', () => {
    const element = document.createElement('div');
    const bold = document.createElement('strong');
    bold.textContent = '世界';
    element.append('你好，', bold, ' hello');
    const addRange = vi.spyOn(window.Selection.prototype, 'addRange');

    expect(selectTextInElement(element, '世界 hello')).toBe(true);
    const range = addRange.mock.calls[0]?.[0] as Range;
    expect(range.toString()).toBe('世界 hello');
  });

  it('returns false when the text does not exist', () => {
    const element = document.createElement('div');
    element.textContent = 'hello';
    window.getSelection()?.removeAllRanges();

    expect(selectTextInElement(element, 'missing')).toBe(false);
    expect(window.getSelection()?.rangeCount).toBe(0);
  });
});

describe('revealSelectionInCodeMirror', () => {
  it('returns false without an editor view', () => {
    expect(revealSelectionInCodeMirror(undefined, 0, 2)).toBe(false);
  });

  it('dispatches a clamped selection and focuses the view', () => {
    const dispatch = vi.fn();
    const focus = vi.fn();
    const view = {
      state: { doc: { length: 5 } },
      dispatch,
      focus,
    } as unknown as Parameters<typeof revealSelectionInCodeMirror>[0];

    expect(revealSelectionInCodeMirror(view, 1, 99)).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 1, head: 5 },
      scrollIntoView: true,
    });
    expect(focus).toHaveBeenCalledOnce();
  });
});

describe('scrollRangeIntoView', () => {
  it('falls back to the browser scrollIntoView without a container', () => {
    const element = document.createElement('span');
    element.textContent = 'hello';
    const range = document.createRange();
    range.selectNodeContents(element);
    const scrollIntoView = vi.fn();
    element.scrollIntoView = scrollIntoView;

    scrollRangeIntoView(range);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
  });
});
