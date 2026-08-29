// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  createHtmlSourceTextRuntimeExpression,
  type HtmlSourceTextRuntime,
} from './html-source-text-frame-script';

function runtime(): HtmlSourceTextRuntime {
  return globalThis.eval(
    createHtmlSourceTextRuntimeExpression(),
  ) as HtmlSourceTextRuntime;
}

function rangeFor(element: Element): Range {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range;
}

describe('HTML source-text frame runtime', () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (globalThis as unknown as Record<string, unknown>).MathJax;
  });

  it('preserves ordinary rendered text', () => {
    document.body.innerHTML = '<p id="plain">普通 <strong>正文</strong></p>';
    const plain = document.querySelector('#plain');
    if (!plain) throw new Error('Expected plain paragraph');

    expect(runtime().readRange(rangeFor(plain))).toBe('普通 正文');
    expect(runtime().readElement(plain)).toBe('普通 正文');
  });

  it('copies the whole KaTeX source for a partial visual selection', () => {
    document.body.innerHTML =
      '<span class="katex">' +
      '<span class="katex-mathml"><math><semantics>' +
      '<annotation encoding="application/x-tex">x^2 + 1</annotation>' +
      '</semantics></math></span>' +
      '<span class="katex-html" aria-hidden="true">x2+1</span>' +
      '</span>';
    const visualText = document.querySelector('.katex-html')?.firstChild;
    if (!visualText) throw new Error('Expected KaTeX visual text');
    const range = document.createRange();
    range.setStart(visualText, 0);
    range.setEnd(visualText, 1);

    expect(runtime().readRange(range)).toBe('$x^2 + 1$');
  });

  it('keeps multiple formulas in document order and marks display TeX', () => {
    document.body.innerHTML =
      '<p id="lesson">前' +
      '<span class="katex"><math><semantics>' +
      '<annotation encoding="application/x-tex">x</annotation>' +
      '</semantics></math><span class="katex-html">x</span></span>' +
      '中<span class="katex-display"><span class="katex">' +
      '<math><semantics><annotation encoding="application/x-tex">y^2</annotation>' +
      '</semantics></math><span class="katex-html">y2</span>' +
      '</span></span>后</p>';
    const lesson = document.querySelector('#lesson');
    if (!lesson) throw new Error('Expected lesson');

    expect(runtime().readRange(rangeFor(lesson))).toBe(
      '前$x$中$$y^2$$后',
    );
  });

  it('reads legacy MathJax TeX from its related source script', () => {
    document.body.innerHTML =
      '<span id="MathJax-Element-1-Frame" class="MathJax">rendered</span>' +
      '<script id="MathJax-Element-1" type="math/tex; mode=display">\\int_0^1 x dx</script>';
    const formula = document.querySelector('.MathJax');
    if (!formula) throw new Error('Expected MathJax formula');

    expect(runtime().readRange(rangeFor(formula))).toBe(
      '$$\\int_0^1 x dx$$',
    );
  });

  it('reads MathJax assistive MathML annotations without duplicating output', () => {
    document.body.innerHTML =
      '<mjx-container class="MathJax" display="true">' +
      '<mjx-assistive-mml><math><semantics>' +
      '<annotation encoding="application/x-tex">a+b</annotation>' +
      '</semantics></math></mjx-assistive-mml>' +
      '<mjx-math>rendered</mjx-math></mjx-container>';
    const formula = document.querySelector('mjx-container');
    if (!formula) throw new Error('Expected MathJax container');

    expect(runtime().readRange(rangeFor(formula))).toBe('$$a+b$$');
  });

  it('reads MathJax 3 source from its runtime when assistive MathML is disabled', () => {
    document.body.innerHTML =
      '<mjx-container id="formula" class="MathJax" display="true">' +
      '<mjx-math>rendered</mjx-math></mjx-container>';
    const formula = document.querySelector('#formula');
    if (!formula) throw new Error('Expected MathJax container');
    Object.defineProperty(globalThis, 'MathJax', {
      configurable: true,
      value: {
        startup: {
          document: {
            math: [{ typesetRoot: formula, math: '\\sum_i x_i', display: true }],
          },
        },
      },
    });

    expect(runtime().readRange(rangeFor(formula))).toBe(
      '$$\\sum_i x_i$$',
    );
  });

  it('uses native MathML markup when no TeX source exists', () => {
    document.body.innerHTML =
      '<math id="native" display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>';
    const formula = document.querySelector('#native');
    if (!formula) throw new Error('Expected native MathML');

    expect(runtime().readRange(rangeFor(formula))).toBe(
      '<math id="native" display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>',
    );
  });

  it('does not add a second delimiter around preserved source', () => {
    document.body.innerHTML =
      '<span id="formula" data-latex="\\(a+b\\)">rendered</span>';
    const formula = document.querySelector('#formula');
    if (!formula) throw new Error('Expected data-latex formula');

    expect(runtime().readRange(rangeFor(formula))).toBe('\\(a+b\\)');
  });
});
