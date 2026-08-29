// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createHtmlSourceCopyInstallFrameScript,
  isHtmlSourceCopyInstallResult,
} from './html-source-copy-frame-script';

interface ClipboardProbe {
  readonly clearData: ReturnType<typeof vi.fn>;
  readonly setData: ReturnType<typeof vi.fn>;
}

function selectContents(element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = globalThis.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function dispatchCopy(): {
  readonly event: Event;
  readonly clipboard: ClipboardProbe;
} {
  const clipboard: ClipboardProbe = {
    clearData: vi.fn(),
    setData: vi.fn(),
  };
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboard });
  document.dispatchEvent(event);
  return { event, clipboard };
}

function cleanupInstaller(): void {
  const root = globalThis as unknown as Record<string, unknown>;
  const state = root.__learningCompanionHtmlSourceCopyV1 as
    | { cleanup(): void }
    | undefined;
  state?.cleanup();
  delete root.__learningCompanionHtmlSourceCopyV1;
}

describe('HTML source-copy frame script', () => {
  afterEach(() => {
    cleanupInstaller();
    globalThis.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
  });

  it('replaces a copied rendered formula with its TeX source', () => {
    document.body.innerHTML =
      '<p id="lesson">公式：<span class="katex">' +
      '<math><semantics><annotation encoding="application/x-tex">x^2</annotation>' +
      '</semantics></math><span class="katex-html">x2</span>' +
      '</span>。</p>';
    const lesson = document.querySelector('#lesson');
    if (!lesson) throw new Error('Expected lesson');
    selectContents(lesson);

    const result = globalThis.eval(
      createHtmlSourceCopyInstallFrameScript(),
    );
    const copied = dispatchCopy();

    expect(result).toEqual({ installed: true });
    expect(copied.clipboard.clearData).toHaveBeenCalledOnce();
    expect(copied.clipboard.setData).toHaveBeenCalledWith(
      'text/plain',
      '公式：$x^2$。',
    );
    expect(copied.event.defaultPrevented).toBe(true);
  });

  it('leaves ordinary text copy to the page and browser', () => {
    document.body.innerHTML = '<p id="plain">普通正文</p>';
    const plain = document.querySelector('#plain');
    if (!plain) throw new Error('Expected plain text');
    selectContents(plain);
    globalThis.eval(createHtmlSourceCopyInstallFrameScript());

    const copied = dispatchCopy();

    expect(copied.clipboard.setData).not.toHaveBeenCalled();
    expect(copied.event.defaultPrevented).toBe(false);
  });

  it('replaces the prior listener when installed repeatedly', () => {
    document.body.innerHTML =
      '<span id="formula" data-tex="x">rendered</span>';
    const formula = document.querySelector('#formula');
    if (!formula) throw new Error('Expected formula');
    selectContents(formula);
    globalThis.eval(createHtmlSourceCopyInstallFrameScript());
    globalThis.eval(createHtmlSourceCopyInstallFrameScript());

    const copied = dispatchCopy();

    expect(copied.clipboard.setData).toHaveBeenCalledTimes(1);
  });

  it('installs even when page script preoccupied the runtime state key', () => {
    const root = globalThis as unknown as Record<string, unknown>;
    root.__learningCompanionHtmlSourceCopyV1 = { cleanup: true };

    expect(() =>
      globalThis.eval(createHtmlSourceCopyInstallFrameScript()),
    ).not.toThrow();
    expect(root.__learningCompanionHtmlSourceCopyV1).toMatchObject({
      cleanup: expect.any(Function),
    });
  });

  it('does not intercept a collapsed selection', () => {
    document.body.innerHTML = '<span data-tex="x">rendered</span>';
    globalThis.eval(createHtmlSourceCopyInstallFrameScript());

    const copied = dispatchCopy();

    expect(copied.clipboard.setData).not.toHaveBeenCalled();
    expect(copied.event.defaultPrevented).toBe(false);
  });

  it('validates only the exact installer result', () => {
    expect(isHtmlSourceCopyInstallResult({ installed: true })).toBe(true);
    expect(isHtmlSourceCopyInstallResult({ installed: false })).toBe(false);
    expect(
      isHtmlSourceCopyInstallResult({ installed: true, extra: true }),
    ).toBe(false);
  });
});
