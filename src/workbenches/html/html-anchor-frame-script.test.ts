// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  createHtmlDomTarget,
  createHtmlElementTarget,
  createHtmlQuoteTarget,
} from './shared';
import {
  createHtmlAnchorClearFrameScript,
  createHtmlAnchorHighlightFrameScript,
} from './html-anchor-frame-script';

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

function installRangeRects(): void {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Range) {
      const parent = this.startContainer.parentElement;
      const top = parent?.id === 'second' ? 200 : 20;
      return { left: 12, top, width: 80, height: 18 };
    },
  });
}

function highlightedTop(): string | undefined {
  const overlay = Array.from(document.documentElement.children).find(
    (element) => element.getAttribute('aria-hidden') === 'true',
  );
  return overlay instanceof HTMLElement ? overlay.style.top : undefined;
}

describe('HTML anchor frame scripts', () => {
  afterEach(() => {
    const root = globalThis as unknown as Record<string, unknown>;
    const state = root.__learningCompanionHtmlAnchorHighlightV1 as
      | { cleanup(): void }
      | undefined;
    state?.cleanup();
    delete root.__learningCompanionHtmlAnchorHighlightV1;
    document.body.replaceChildren();
    delete (Range.prototype as unknown as Record<string, unknown>)
      .getBoundingClientRect;
  });

  it('embeds only the validated command data in a self-contained resolver', () => {
    const script = createHtmlAnchorHighlightFrameScript({
      target: createHtmlDomTarget({
        frameUrl: 'learning-content://resource/token',
        element: { path: [1], tagName: 'p' },
      }),
      revision: 7,
      reveal: true,
      durationMs: 2_800,
    });

    expect(script).toContain('runHtmlAnchorFrameCommand');
    expect(script).toContain('html.dom');
    expect(script).toContain('"revision":7');
    expect(script).toContain('"reveal":true');
  });

  it('creates a revision-scoped clear command', () => {
    const script = createHtmlAnchorClearFrameScript({
      target: createHtmlQuoteTarget('锚点正文'),
      revision: 9,
    });

    expect(script).toContain('"action":"clear"');
    expect(script).toContain('"revision":9');
  });

  it('resolves the inferred DOM element after responsive layout reflow', async () => {
    document.body.innerHTML =
      '<p id="first">第一段前文 重复正文 第一段后文</p>' +
      '<p id="second">第二段前文 重复正文 第二段后文</p>';
    const second = document.querySelector('#second');
    if (!second) throw new Error('Expected second paragraph');
    Object.defineProperty(second, 'getBoundingClientRect', {
      value: () => ({ left: 12, top: 200, width: 80, height: 18 }),
    });
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element: {
        path: elementPathFromDocumentElement(second),
        tagName: 'p',
        id: 'second',
        textQuote: second.textContent ?? undefined,
      },
    });

    await expect(
      globalThis.eval(
        createHtmlAnchorHighlightFrameScript({
          target,
          revision: 1,
          reveal: false,
          durationMs: 0,
        }),
      ),
    ).resolves.toEqual({ found: true });
    expect(highlightedTop()).toBe('198px');
  });

  it('resolves the table row inferred from a cross-cell text gesture', async () => {
    document.body.innerHTML =
      '<table><tbody><tr>' +
      '<td id="start">MSE 损失</td>' +
      '<td>高</td>' +
      '<td id="end">会算单样本损失、batch 平均损失</td>' +
      '</tr></tbody></table>';
    const row = document.querySelector('tr');
    if (!row) throw new Error('Expected table row');
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element: {
        path: elementPathFromDocumentElement(row),
        tagName: 'tr',
        textQuote: row.textContent ?? undefined,
      },
    });

    await expect(
      globalThis.eval(
        createHtmlAnchorHighlightFrameScript({
          target,
          revision: 3,
          reveal: false,
          durationMs: 0,
        }),
      ),
    ).resolves.toEqual({ found: true });
  });

  it('falls back to a formula-source text quote when the DOM path changed', async () => {
    document.body.innerHTML =
      '<p id="formula">公式：<span class="katex">' +
      '<span class="katex-mathml"><math><semantics>' +
      '<mrow><msup><mi>x</mi><mn>2</mn></msup></mrow>' +
      '<annotation encoding="application/x-tex">x^2</annotation>' +
      '</semantics></math></span>' +
      '<span class="katex-html" aria-hidden="true">x2</span>' +
      '</span></p>';
    const formula = document.querySelector('#formula');
    if (!formula) throw new Error('Expected formula paragraph');
    Object.defineProperty(formula, 'getBoundingClientRect', {
      value: () => ({ left: 12, top: 120, width: 160, height: 24 }),
    });
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element: {
        path: [999],
        tagName: 'p',
        textQuote: '公式：$x^2$',
      },
    });

    await expect(
      globalThis.eval(
        createHtmlAnchorHighlightFrameScript({
          target,
          revision: 4,
          reveal: false,
          durationMs: 0,
        }),
      ),
    ).resolves.toEqual({ found: true });
    expect(highlightedTop()).toBe('118px');
  });

  it('uses the captured element identity instead of matching duplicate page text', async () => {
    document.body.innerHTML =
      '<p id="first">前文 重复正文 后文</p>' +
      '<p id="second">前文 重复正文 后文</p>';
    const second = document.querySelector('#second');
    if (!second) throw new Error('Expected second paragraph');
    Object.defineProperty(second, 'getBoundingClientRect', {
      value: () => ({ left: 12, top: 200, width: 80, height: 18 }),
    });
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element: {
        path: [999],
        tagName: 'p',
        id: 'second',
        textQuote: '前文 重复正文 后文',
      },
    });

    await expect(
      globalThis.eval(
        createHtmlAnchorHighlightFrameScript({
          target,
          revision: 5,
          reveal: false,
          durationMs: 0,
        }),
      ),
    ).resolves.toEqual({ found: true });
    expect(highlightedTop()).toBe('198px');
  });

  it('resolves a whole-element DOM anchor without a second anchor type', async () => {
    document.body.innerHTML = '<section id="lesson">完整章节</section>';
    const lesson = document.querySelector('#lesson');
    if (!lesson) throw new Error('Expected lesson element');
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element: {
        path: elementPathFromDocumentElement(lesson),
        tagName: 'section',
        id: 'lesson',
        textQuote: '完整章节',
      },
    });

    await expect(
      globalThis.eval(
        createHtmlAnchorHighlightFrameScript({
          target,
          revision: 6,
          reveal: false,
          durationMs: 0,
        }),
      ),
    ).resolves.toEqual({ found: true });
  });

  it('keeps resolving legacy quote anchors that have no DOM Range', async () => {
    document.body.innerHTML = '<p id="first">旧版唯一锚点</p>';
    installRangeRects();

    await expect(
      globalThis.eval(
        createHtmlAnchorHighlightFrameScript({
          target: createHtmlQuoteTarget('旧版唯一锚点'),
          revision: 2,
          reveal: false,
          durationMs: 0,
        }),
      ),
    ).resolves.toEqual({ found: true });
    expect(highlightedTop()).toBe('18px');
  });

  it('keeps resolving persisted legacy element anchors', async () => {
    document.body.innerHTML = '<section id="legacy">旧版元素</section>';
    const legacy = document.querySelector('#legacy');
    if (!legacy) throw new Error('Expected legacy element');

    await expect(
      globalThis.eval(
        createHtmlAnchorHighlightFrameScript({
          target: createHtmlElementTarget({
            frameUrl: 'learning-content://resource/token',
            tagName: 'section',
            domPath: elementPathFromDocumentElement(legacy),
            rect: { x: 0, y: 0, width: 100, height: 20 },
            id: 'legacy',
            textQuote: '旧版元素',
          }),
          revision: 7,
          reveal: false,
          durationMs: 0,
        }),
      ),
    ).resolves.toEqual({ found: true });
  });

  it('resolves legacy table selections without a DOM Range', async () => {
    document.body.innerHTML =
      '<table><tbody><tr>' +
      '<td>MSE 损失</td><td>高</td>' +
      '<td>会算单样本损失、batch 平均损失</td>' +
      '</tr></tbody></table>';
    installRangeRects();

    await expect(
      globalThis.eval(
        createHtmlAnchorHighlightFrameScript({
          target: createHtmlQuoteTarget(
            'MSE 损失\t高\t会算单样本损失、batch 平均损失',
          ),
          revision: 4,
          reveal: false,
          durationMs: 0,
        }),
      ),
    ).resolves.toEqual({ found: true });
  });

});
