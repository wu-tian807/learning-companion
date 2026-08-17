// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { READ_HTML_FRAME_SELECTION_SCRIPT } from './main-facility-adapters';

function elementPathFromDocumentElement(element: Element): readonly number[] {
  const path: number[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    const parent: Element | null = current.parentElement;
    if (!parent) throw new Error('Element is outside the document');
    path.unshift(Array.prototype.indexOf.call(parent.children, current));
    current = parent;
  }
  return path;
}

describe('HTML selection frame script', () => {
  afterEach(() => {
    globalThis.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
  });

  it('turns a text-selection gesture into the containing DOM element', () => {
    document.body.innerHTML =
      '<p>相同前文 <strong>选中的正文</strong> 相同后文</p>';
    const strong = document.querySelector('strong');
    const text = strong?.firstChild;
    if (!text) throw new Error('Expected selection text node');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.textContent?.length ?? 0);
    Object.defineProperty(strong, 'getBoundingClientRect', {
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
      readonly element: {
        readonly path: readonly number[];
        readonly tagName: string;
        readonly textQuote: string;
      };
    };

    expect(result).toEqual({
      text: '选中的正文',
      rect: { x: 10, y: 20, width: 120, height: 18 },
      element: {
        path: elementPathFromDocumentElement(strong!),
        tagName: 'strong',
        textQuote: '选中的正文',
      },
    });
  });

  it('turns a cross-cell text gesture into one table-row element', () => {
    document.body.innerHTML =
      '<table><tbody><tr>' +
      '<td id="start">MSE 损失</td>' +
      '<td>高</td>' +
      '<td id="end">会算单样本损失、batch 平均损失</td>' +
      '</tr></tbody></table>';
    const row = document.querySelector('tr');
    const start = document.querySelector('#start')?.firstChild;
    const end = document.querySelector('#end')?.firstChild;
    if (!row || !start || !end?.textContent) {
      throw new Error('Expected table selection nodes');
    }
    Object.defineProperty(row, 'getBoundingClientRect', {
      value: () => ({ x: 8, y: 16, width: 480, height: 42 }),
    });
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.textContent.length);
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const result = globalThis.eval(
      READ_HTML_FRAME_SELECTION_SCRIPT,
    ) as Record<string, unknown>;

    expect(result).toMatchObject({
      text: selection?.toString(),
      rect: { x: 8, y: 16, width: 480, height: 42 },
      element: {
        path: elementPathFromDocumentElement(row),
        tagName: 'tr',
      },
    });
    expect(result).not.toHaveProperty('range');
  });
});
