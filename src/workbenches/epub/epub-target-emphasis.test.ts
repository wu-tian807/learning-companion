// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { emphasizeEpubRange } from './epub-target-emphasis';

describe('EPUB target emphasis', () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('selects the located text brightly and clears it after the timeout', () => {
    vi.useFakeTimers();
    document.body.textContent = '需要短暂提示的原文';
    const text = document.body.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 7);

    emphasizeEpubRange(range, 1_600);
    expect(document.getSelection()?.toString()).toBe('短暂提示的');

    vi.advanceTimersByTime(1_600);
    expect(document.getSelection()?.rangeCount).toBe(0);
  });

  it('does not clear a newer user selection when the old timer expires', () => {
    vi.useFakeTimers();
    document.body.textContent = '第一段第二段';
    const text = document.body.firstChild!;
    const flashed = document.createRange();
    flashed.setStart(text, 0);
    flashed.setEnd(text, 3);
    emphasizeEpubRange(flashed, 1_600);

    const userRange = document.createRange();
    userRange.setStart(text, 3);
    userRange.setEnd(text, 6);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(userRange);
    vi.advanceTimersByTime(1_600);

    expect(selection.toString()).toBe('第二段');
  });
});
