// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { createHtmlQuoteTarget } from './shared';
import {
  createHtmlAnchorClearFrameScript,
  createHtmlAnchorHighlightFrameScript,
} from './html-anchor-frame-script';

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
      target: createHtmlQuoteTarget('包含 ` 与 ${danger} 的文本'),
      revision: 7,
      reveal: true,
      durationMs: 2_800,
    });

    expect(script).toContain('runHtmlAnchorFrameCommand');
    expect(script).toContain('html.quote');
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

  it('resolves the original DOM Range after responsive layout reflow', async () => {
    document.body.innerHTML =
      '<p id="first">第一段前文 重复正文 第一段后文</p>' +
      '<p id="second">第二段前文 重复正文 第二段后文</p>';
    installRangeRects();
    const text = document.querySelector('#second')?.firstChild;
    if (!text?.textContent) throw new Error('Expected second text node');
    const start = text.textContent.indexOf('重复正文');
    const target = createHtmlQuoteTarget(
      '重复正文',
      undefined,
      { x: 300, y: 80, width: 200, height: 18 },
      {
        domRange: {
          start: { path: pathFromDocumentElement(text), offset: start },
          end: {
            path: pathFromDocumentElement(text),
            offset: start + '重复正文'.length,
          },
        },
      },
    );

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

  it('resolves a DOM Range whose browser selection inserts table separators', async () => {
    document.body.innerHTML =
      '<table><tbody><tr>' +
      '<td id="start">MSE 损失</td>' +
      '<td>高</td>' +
      '<td id="end">会算单样本损失、batch 平均损失</td>' +
      '</tr></tbody></table>';
    installRangeRects();
    const start = document.querySelector('#start')?.firstChild;
    const end = document.querySelector('#end')?.firstChild;
    if (!start?.textContent || !end?.textContent) {
      throw new Error('Expected table text nodes');
    }
    const target = createHtmlQuoteTarget(
      'MSE 损失\t高\t会算单样本损失、batch 平均损失',
      undefined,
      undefined,
      {
        domRange: {
          start: { path: pathFromDocumentElement(start), offset: 0 },
          end: {
            path: pathFromDocumentElement(end),
            offset: end.textContent.length,
          },
        },
      },
    );

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
