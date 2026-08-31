// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EpubReadingTimerControl } from './epub-reading-timer-control';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function button(container: ParentNode, name: string): HTMLButtonElement {
  const target = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(target instanceof HTMLButtonElement)) {
    throw new Error(`找不到按钮：${name}`);
  }
  return target;
}

function changeInput(container: ParentNode, value: string): void {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="阅读时长（分钟）"]',
  );
  if (!input) throw new Error('找不到阅读时长输入框');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('EpubReadingTimerControl', () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T08:00:00.000Z'));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<EpubReadingTimerControl />));
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
    container.remove();
    vi.useRealTimers();
  });

  it('starts a session, shows remaining time, and reminds the reader at expiry', () => {
    act(() => button(container, '定时').click());
    changeInput(container, '1');
    act(() => button(container, '开始计时').click());

    expect(container.textContent).toContain('01:00');

    act(() => vi.advanceTimersByTime(30_000));
    expect(container.textContent).toContain('00:30');

    act(() => vi.advanceTimersByTime(30_000));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      '阅读时间到了，该休息一下了',
    );
    expect(container.textContent).not.toContain('00:00');

    act(() => button(document, '重新定时').click());
    expect(container.querySelector('[aria-label="阅读定时设置"]')).not.toBeNull();
    expect(button(container, '开始计时')).not.toBeNull();
  });

  it('allows a running timer to be reset to a different duration', () => {
    act(() => button(container, '定时').click());
    changeInput(container, '1');
    act(() => button(container, '开始计时').click());
    act(() => vi.advanceTimersByTime(30_000));

    changeInput(container, '2');
    act(() => button(container, '更新计时').click());

    expect(container.textContent).toContain('02:00');
    act(() => vi.advanceTimersByTime(60_000));
    expect(container.textContent).toContain('01:00');
  });

  it('keeps counting when the settings panel is closed', () => {
    act(() => button(container, '定时').click());
    changeInput(container, '1');
    act(() => button(container, '开始计时').click());
    act(() => button(container, '收起').click());
    act(() => vi.advanceTimersByTime(15_000));

    expect(container.querySelector('[aria-label="阅读定时设置"]')).toBeNull();
    expect(container.textContent).toContain('00:45');
  });

  it('can stop a timer without producing a later reminder', () => {
    act(() => button(container, '定时').click());
    changeInput(container, '1');
    act(() => button(container, '开始计时').click());
    act(() => button(container, '关闭计时').click());
    act(() => vi.advanceTimersByTime(120_000));

    expect(container.textContent).not.toContain('00:');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    changeInput(container, '2');
    act(() => button(container, '开始计时').click());
    expect(container.textContent).toContain('02:00');
  });

  it('detects expiry after a background time jump on the next clock tick', () => {
    act(() => button(container, '定时').click());
    changeInput(container, '1');
    act(() => button(container, '开始计时').click());

    vi.setSystemTime(new Date('2026-08-30T08:05:00.000Z'));
    act(() => vi.advanceTimersByTime(1_000));

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it('keeps the start action disabled for unsupported durations', () => {
    act(() => button(container, '定时').click());
    changeInput(container, '0');
    expect(button(container, '开始计时').disabled).toBe(true);
    changeInput(container, '241');
    expect(button(container, '开始计时').disabled).toBe(true);
  });

  it('cleans up its clock when the EPUB workbench unmounts', () => {
    act(() => button(container, '定时').click());
    changeInput(container, '1');
    act(() => button(container, '开始计时').click());
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => root?.unmount());
    root = undefined;

    expect(vi.getTimerCount()).toBe(0);
  });
});
