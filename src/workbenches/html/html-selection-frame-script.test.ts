// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { READ_HTML_FRAME_SELECTION_SCRIPT } from './main-facility-adapters';

function pathFromDocumentElement(node: Node): readonly number[] {
  const path: number[] = [];
  let current: Node | null = node;

  while (current && current !== document.documentElement) {
    const parent: Node | null = current.parentNode;
    if (!parent) throw new Error('Node is outside the document');
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }
  return path;
}

describe('HTML selection frame script', () => {
  afterEach(() => {
    globalThis.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
  });

  it('captures stable DOM boundaries and quote context with the viewport rect', () => {
    document.body.innerHTML =
      '<p>相同前文 <strong>选中的正文</strong> 相同后文</p>';
    const text = document.querySelector('strong')?.firstChild;
    if (!text) throw new Error('Expected selection text node');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.textContent?.length ?? 0);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ x: 10, y: 20, width: 120, height: 18 }),
    });
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const result = globalThis.eval(
      READ_HTML_FRAME_SELECTION_SCRIPT,
    ) as {
      readonly text: string;
      readonly rect: unknown;
      readonly domRange: {
        readonly start: { readonly path: readonly number[]; readonly offset: number };
        readonly end: { readonly path: readonly number[]; readonly offset: number };
      };
    };

    expect(result).toEqual({
      text: '选中的正文',
      rect: { x: 10, y: 20, width: 120, height: 18 },
      domRange: {
        start: { path: pathFromDocumentElement(text), offset: 0 },
        end: {
          path: pathFromDocumentElement(text),
          offset: text.textContent?.length ?? 0,
        },
      },
    });
  });
});
