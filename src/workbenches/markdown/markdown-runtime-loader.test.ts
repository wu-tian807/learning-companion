import { describe, expect, it, vi } from 'vitest';

import { MarkdownRuntimeLoader } from './markdown-runtime-loader';

class FakeElement extends EventTarget {
  id = '';
  readonly tagName: string;
  private readonly onRemove: (element: FakeElement) => void;

  constructor(
    tagName: string,
    onRemove: (element: FakeElement) => void,
  ) {
    super();
    this.tagName = tagName.toUpperCase();
    this.onRemove = onRemove;
  }

  remove(): void {
    this.onRemove(this);
  }
}

class FakeScriptElement extends FakeElement {
  async = false;
  src = '';

  constructor(onRemove: (element: FakeElement) => void) {
    super('script', onRemove);
  }
}

class FakeDocument {
  private readonly elements = new Map<string, FakeElement>();
  readonly appendedScripts: FakeScriptElement[] = [];
  readonly head = {
    appendChild: (element: FakeElement) => {
      this.elements.set(element.id, element);
      if (element instanceof FakeScriptElement) {
        this.appendedScripts.push(element);
      }
      return element;
    },
  };

  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) ?? null;
  }

  createElement(tagName: string): FakeElement {
    const remove = (element: FakeElement) => {
      if (element.id) {
        this.elements.delete(element.id);
      }
    };
    const element =
      tagName === 'script'
        ? new FakeScriptElement(remove)
        : new FakeElement(tagName, remove);
    return element;
  }

  addMarker(id: string): void {
    const marker = this.createElement('svg');
    marker.id = id;
    this.head.appendChild(marker);
  }
}

function asDocument(document: FakeDocument): Document {
  return document as unknown as Document;
}

describe('MarkdownRuntimeLoader', () => {
  it('deduplicates concurrent cold loads until both runtimes are ready', async () => {
    const document = new FakeDocument();
    const initialize = vi.fn();
    const runtimeGlobal: {
      mermaid?: { initialize: typeof initialize };
    } = {};
    const loader = new MarkdownRuntimeLoader({
      document: asDocument(document),
      runtimeGlobal,
    });
    let firstSettled = false;
    const first = loader
      .load('learning://vendor/vditor')
      .finally(() => {
        firstSettled = true;
      });
    const second = loader.load('learning://vendor/vditor');

    expect(document.appendedScripts).toHaveLength(2);
    const iconScript = document.appendedScripts.find(
      (script) => script.id === 'vditorIconScript',
    )!;
    const mermaidScript = document.appendedScripts.find(
      (script) => script.id === 'vditorMermaidScript',
    )!;
    runtimeGlobal.mermaid = { initialize };
    mermaidScript.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(firstSettled).toBe(false);

    document.addMarker('vditor-icon-bold');
    iconScript.dispatchEvent(new Event('load'));
    await Promise.all([first, second]);

    expect(document.appendedScripts).toHaveLength(2);
    runtimeGlobal.mermaid.initialize({
      securityLevel: 'loose',
      flowchart: { htmlLabels: true },
    });
    expect(initialize).toHaveBeenCalledWith({
      securityLevel: 'strict',
      flowchart: { htmlLabels: false },
    });
  });

  it('clears a failed script task so a later attempt can retry', async () => {
    const document = new FakeDocument();
    const runtimeGlobal = {
      mermaid: { initialize: vi.fn() },
    };
    const loader = new MarkdownRuntimeLoader({
      document: asDocument(document),
      runtimeGlobal,
    });
    const first = loader.load('learning://vendor/vditor');
    const firstIconScript = document.appendedScripts[0]!;

    firstIconScript.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow(
      'Vditor 本地图标资源加载失败',
    );

    const second = loader.load('learning://vendor/vditor');
    const secondIconScript = document.appendedScripts.at(-1)!;
    expect(secondIconScript).not.toBe(firstIconScript);
    document.addMarker('vditor-icon-bold');
    secondIconScript.dispatchEvent(new Event('load'));

    await expect(second).resolves.toBeUndefined();
  });

  it('lets a StrictMode-style abandoned consumer abort without cancelling the shared load', async () => {
    const document = new FakeDocument();
    const runtimeGlobal: {
      mermaid?: { initialize(options: Record<string, unknown>): void };
    } = {};
    const loader = new MarkdownRuntimeLoader({
      document: asDocument(document),
      runtimeGlobal,
    });
    const controller = new AbortController();
    const abandoned = loader.load(
      'learning://vendor/vditor',
      controller.signal,
    );
    const active = loader.load('learning://vendor/vditor');

    controller.abort();
    await expect(abandoned).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(document.appendedScripts).toHaveLength(2);

    const iconScript = document.appendedScripts.find(
      (script) => script.id === 'vditorIconScript',
    )!;
    const mermaidScript = document.appendedScripts.find(
      (script) => script.id === 'vditorMermaidScript',
    )!;
    document.addMarker('vditor-icon-bold');
    runtimeGlobal.mermaid = { initialize: vi.fn() };
    iconScript.dispatchEvent(new Event('load'));
    mermaidScript.dispatchEvent(new Event('load'));

    await expect(active).resolves.toBeUndefined();
  });
});
