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
  createHtmlEditIndicatorClearFrameScript,
  createHtmlEditIndicatorFrameScript,
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
    const editState = root.__learningCompanionHtmlEditIndicatorV1 as
      | { cleanup(): void }
      | undefined;
    editState?.cleanup();
    delete root.__learningCompanionHtmlEditIndicatorV1;
    document.body.replaceChildren();
    delete (Range.prototype as unknown as Record<string, unknown>)
      .getBoundingClientRect;
    delete (globalThis as unknown as Record<string, unknown>).matchMedia;
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

  it('keeps the edit indicator independent from the history anchor outline', async () => {
    document.body.innerHTML =
      '<p id="history">历史引用</p><p id="editing">正在编辑</p>';
    const history = document.querySelector('#history');
    const editing = document.querySelector('#editing');
    if (!history || !editing) throw new Error('Expected paragraphs');
    for (const [element, top] of [[history, 20], [editing, 80]] as const) {
      Object.defineProperty(element, 'getBoundingClientRect', {
        value: () => ({ left: 12, top, width: 80, height: 18 }),
      });
    }
    const historyTarget = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element: {
        path: elementPathFromDocumentElement(history),
        tagName: 'p',
        id: 'history',
      },
    });
    const editingTarget = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element: {
        path: elementPathFromDocumentElement(editing),
        tagName: 'p',
        id: 'editing',
      },
    });

    await globalThis.eval(
      createHtmlAnchorHighlightFrameScript({
        target: historyTarget,
        revision: 1,
        reveal: false,
        durationMs: 0,
      }),
    );
    await expect(
      globalThis.eval(
        createHtmlEditIndicatorFrameScript({
          target: editingTarget,
          revision: 1,
          phase: 'editing',
        }),
      ),
    ).resolves.toEqual({ found: true });

    const root = globalThis as unknown as Record<string, unknown>;
    expect(root.__learningCompanionHtmlAnchorHighlightV1).toBeDefined();
    expect(root.__learningCompanionHtmlEditIndicatorV1).toBeDefined();
    expect(
      document.querySelectorAll('[aria-hidden="true"]'),
    ).toHaveLength(2);
    const editMask = document.querySelector(
      '[data-learning-companion-edit-mask="editing"]',
    );
    expect(editMask).toBeInstanceOf(HTMLElement);
    expect(
      editMask?.querySelector(
        '[data-learning-companion-edit-wave-viewport]',
      ),
    ).toBeInstanceOf(HTMLElement);
    const waveSweep = editMask?.querySelector(
      '[data-learning-companion-edit-wave-sweep]',
    ) as HTMLElement | null;
    expect(waveSweep).toBeInstanceOf(HTMLElement);
    expect(waveSweep?.style.filter).toContain(
      'learning-companion-edit-wave-filter-1',
    );
    expect(waveSweep?.style.getPropertyPriority('transform')).toBe('');
    expect(waveSweep?.style.getPropertyPriority('opacity')).toBe('');
    expect(
      editMask?.querySelector(
        '[data-learning-companion-edit-wave-filter]',
      ),
    ).toBeInstanceOf(SVGElement);
    expect(
      editMask?.querySelector('[data-learning-companion-edit-beam-glow]'),
    ).toBeInstanceOf(HTMLElement);
    expect(
      editMask?.querySelector('[data-learning-companion-edit-beam-core]'),
    ).toBeInstanceOf(HTMLElement);
    expect(
      editMask?.querySelector(
        '[data-learning-companion-edit-beam-highlight]',
      ),
    ).toBeInstanceOf(HTMLElement);
    expect(
      editMask?.querySelector('[data-learning-companion-edit-status]'),
    ).toBeInstanceOf(HTMLElement);
    expect(
      editMask?.querySelector('[data-learning-companion-edit-status-text]')
        ?.textContent,
    ).toBe('正在重写');
    expect(
      editMask?.querySelector('[data-learning-companion-edit-cursor]'),
    ).toBeNull();
    expect(
      editMask?.querySelector(
        '[data-learning-companion-edit-cursor-viewport]',
      ),
    ).toBeNull();
    expect(
      editMask?.querySelector('[data-learning-companion-edit-code-lines]'),
    ).toBeNull();
    expect(
      editMask?.querySelectorAll('[data-learning-companion-edit-corner]'),
    ).toHaveLength(0);

    await globalThis.eval(
      createHtmlEditIndicatorClearFrameScript({
        target: editingTarget,
        revision: 1,
      }),
    );
    expect(root.__learningCompanionHtmlAnchorHighlightV1).toBeDefined();
    expect(root.__learningCompanionHtmlEditIndicatorV1).toBeUndefined();
    expect(
      document.querySelector('[data-learning-companion-edit-mask]'),
    ).toBeNull();
  });

  it('renders rejected edits as a warning mask without a sweep', async () => {
    document.body.innerHTML = '<main><section id="target">Draft</section></main>';
    const target = document.querySelector('#target');
    if (!target) throw new Error('Expected target section');
    Object.defineProperty(target, 'getBoundingClientRect', {
      value: () => ({ left: 20, top: 30, width: 240, height: 80 }),
    });

    await expect(
      globalThis.eval(
        createHtmlEditIndicatorFrameScript({
          target: createHtmlDomTarget({
            frameUrl: 'learning-content://resource/token',
            element: {
              path: elementPathFromDocumentElement(target),
              tagName: 'section',
              id: 'target',
            },
          }),
          revision: 2,
          phase: 'rejected',
        }),
      ),
    ).resolves.toEqual({ found: true });

    const rejectedMask = document.querySelector(
      '[data-learning-companion-edit-mask="rejected"]',
    );
    expect(rejectedMask).toBeInstanceOf(HTMLElement);
    expect(
      rejectedMask?.querySelector('[data-learning-companion-edit-texture]'),
    ).toBeInstanceOf(HTMLElement);
    expect(
      rejectedMask?.querySelector('[data-learning-companion-edit-status-text]')
        ?.textContent,
    ).toBe('修改未应用');
    expect(
      rejectedMask?.querySelector('[data-learning-companion-edit-cursor]'),
    ).toBeNull();
    expect(
      rejectedMask?.querySelector(
        '[data-learning-companion-edit-wave-viewport]',
      ),
    ).toBeNull();
    expect(
      rejectedMask?.querySelectorAll(
        '[data-learning-companion-edit-corner]',
      ),
    ).toHaveLength(0);
    expect(
      (
        rejectedMask?.querySelector(
          '[data-learning-companion-edit-status]',
        ) as HTMLElement | null
      )?.style.top,
    ).toBe('38px');
  });

  it('keeps a static wave without SVG motion when reduced motion is requested', async () => {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true }),
    });
    document.body.innerHTML = '<section id="target">Draft</section>';
    const target = document.querySelector('#target');
    if (!target) throw new Error('Expected target section');
    Object.defineProperty(target, 'getBoundingClientRect', {
      value: () => ({ left: 20, top: 80, width: 240, height: 80 }),
    });

    await globalThis.eval(
      createHtmlEditIndicatorFrameScript({
        target: createHtmlDomTarget({
          frameUrl: 'learning-content://resource/token',
          element: {
            path: elementPathFromDocumentElement(target),
            tagName: 'section',
            id: 'target',
          },
        }),
        revision: 3,
        phase: 'editing',
      }),
    );

    const sweep = document.querySelector(
      '[data-learning-companion-edit-wave-sweep]',
    ) as HTMLElement | null;
    expect(sweep?.style.opacity).toBe('0.6');
    expect(
      document.querySelector(
        '[data-learning-companion-edit-wave-filter] animate',
      ),
    ).toBeNull();
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

  it('returns not found when the historical DOM element no longer contains its quote', async () => {
    document.body.innerHTML = '<p id="lesson">修改后的正文</p>';
    const paragraph = document.querySelector('#lesson');
    if (!paragraph) throw new Error('Expected paragraph');
    const target = createHtmlDomTarget({
      frameUrl: 'learning-content://resource/token',
      element: {
        path: elementPathFromDocumentElement(paragraph),
        tagName: 'p',
        id: 'lesson',
        textQuote: '引用时的原文',
      },
    });

    await expect(
      globalThis.eval(
        createHtmlAnchorHighlightFrameScript({
          target,
          revision: 8,
          reveal: true,
          durationMs: 2_800,
        }),
      ),
    ).resolves.toEqual({ found: false });
    expect(
      document.querySelector('[aria-hidden="true"]'),
    ).toBeNull();
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
