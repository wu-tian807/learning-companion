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

  it('uses the KaTeX source once for selection text and the DOM Anchor quote', () => {
    document.body.innerHTML =
      '<p id="formula">勾股定理：' +
      '<span class="katex">' +
      '<span class="katex-mathml"><math><semantics>' +
      '<mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo>' +
      '<msup><mi>y</mi><mn>2</mn></msup><mo>=</mo>' +
      '<msup><mi>z</mi><mn>2</mn></msup></mrow>' +
      '<annotation encoding="application/x-tex">x^2 + y^2 = z^2</annotation>' +
      '</semantics></math></span>' +
      '<span class="katex-html" aria-hidden="true">x2+y2=z2</span>' +
      '</span>。</p>';
    const formula = document.querySelector('#formula');
    if (!formula) throw new Error('Expected formula paragraph');
    Object.defineProperty(formula, 'getBoundingClientRect', {
      value: () => ({ x: 10, y: 20, width: 240, height: 24 }),
    });
    const range = document.createRange();
    range.selectNodeContents(formula);
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const result = globalThis.eval(
      READ_HTML_FRAME_SELECTION_SCRIPT,
    ) as {
      readonly text: string;
      readonly element: { readonly textQuote?: string };
    };

    expect(result.text).toBe('勾股定理：$x^2 + y^2 = z^2$。');
    expect(result.element.textQuote).toBe(
      '勾股定理：$x^2 + y^2 = z^2$。',
    );
  });

  it('anchors a partial visual selection to the outer formula element', () => {
    document.body.innerHTML =
      '<p>公式：<span id="formula" class="katex">' +
      '<math><semantics><annotation encoding="application/x-tex">x^2</annotation>' +
      '</semantics></math><span class="katex-html">x2</span>' +
      '</span></p>';
    const formula = document.querySelector('#formula');
    const visualText = document.querySelector('.katex-html')?.firstChild;
    if (!formula || !visualText) throw new Error('Expected formula nodes');
    Object.defineProperty(formula, 'getBoundingClientRect', {
      value: () => ({ x: 15, y: 25, width: 48, height: 22 }),
    });
    const range = document.createRange();
    range.setStart(visualText, 0);
    range.setEnd(visualText, 1);
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
        readonly textQuote?: string;
      };
    };

    expect(result).toEqual({
      text: '$x^2$',
      rect: { x: 15, y: 25, width: 48, height: 22 },
      element: {
        path: elementPathFromDocumentElement(formula),
        tagName: 'span',
        id: 'formula',
        textQuote: '$x^2$',
      },
    });
  });
});
