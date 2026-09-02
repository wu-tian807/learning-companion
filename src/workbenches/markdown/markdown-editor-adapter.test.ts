import { createRequire } from 'node:module';
import type Vditor from 'vditor';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('vditor', () => ({
  default: vi.fn(),
}));

import {
  configureMarkdownParserForDocument,
  isMarkdownEmbeddedImageSourceAllowed,
  isMarkdownNetworkRendererAllowed,
  isSafeMarkdownExternalLink,
  MARKDOWN_PREVIEW_RENDER_POLICY,
  MarkdownEditorAdapter,
  type MarkdownEditorAdapterDependencies,
  MarkdownEditorInputGate,
} from './markdown-editor-adapter';

interface TestLuteParser {
  Md2VditorDOM(markdown: string): string;
  SetYamlFrontMatter(enabled: boolean): void;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function createEditorHarness(input?: {
  readonly initializationError?: Error;
}) {
  let after: (() => void) | undefined;
  let frame: FrameRequestCallback | undefined;
  const editableElement = {
    scrollTop: 0,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    scrollBy: vi.fn(),
  } as unknown as HTMLElement;
  const editor = {
    disabledCache: vi.fn(() => {
      if (input?.initializationError) {
        throw input.initializationError;
      }
    }),
    setValue: vi.fn(),
    getValue: vi.fn(() => '# value'),
    focus: vi.fn(),
    blur: vi.fn(),
    destroy: vi.fn(),
    deleteValue: vi.fn(),
    insertValue: vi.fn(),
    vditor: {
      lute: {
        SetYamlFrontMatter: vi.fn(),
      },
      options: {},
      outline: {
        toggle: vi.fn(),
      },
      wysiwyg: {
        element: editableElement,
      },
      toolbar: {
        elements: {},
      },
      undo: {},
    },
  } as unknown as Vditor;
  const dependencies: Partial<MarkdownEditorAdapterDependencies> = {
    runtimeLoader: {
      load: vi.fn(async () => undefined),
    },
    createEditor: vi.fn((_host, options) => {
      after = options.after;
      return editor;
    }),
    requestFrame: vi.fn((callback) => {
      frame = callback;
      return 7;
    }),
    cancelFrame: vi.fn(),
  };

  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    },
  );

  return {
    dependencies,
    editor,
    triggerAfter: () => after?.(),
    triggerFrame: () => frame?.(0),
  };
}

function createEditorOptions(signal?: AbortSignal) {
  return {
    host: {} as HTMLElement,
    initialValue: '# 初始内容',
    initialScrollTop: 12,
    outlineVisible: false,
    resourceBaseUrl: 'learning://vendor/vditor',
    readyTimeoutMs: 1_000,
    onInput: vi.fn(),
    onScroll: vi.fn(),
    onOpenExternal: vi.fn(),
    onError: vi.fn(),
    signal,
  };
}

function createTestLuteParser(): TestLuteParser {
  const nodeRequire = createRequire(import.meta.url);
  nodeRequire(
    '../../../node_modules/vditor/dist/js/lute/lute.min.js',
  );
  const runtime = (
    globalThis as typeof globalThis & {
      Lute?: { New(): TestLuteParser };
    }
  ).Lute;

  if (!runtime) {
    throw new Error('Vditor Lute test runtime is unavailable');
  }

  return runtime.New();
}

describe('Markdown YAML front matter tolerance', () => {
  it('falls back to ordinary Markdown for a malformed leading delimiter', () => {
    const controller = {
      SetYamlFrontMatter: vi.fn(),
    };
    const markdown = '---aaa---\n**123**';

    expect(
      configureMarkdownParserForDocument(controller, markdown),
    ).toEqual([
      {
        feature: 'yaml-front-matter',
        mode: 'literal-fallback',
        reason: 'malformed-opener',
      },
    ]);
    expect(controller.SetYamlFrontMatter).toHaveBeenCalledWith(false);
  });

  it('keeps later formatting parseable in the real Lute runtime', () => {
    const markdown = '---aaa---\n**123**';
    const lute = createTestLuteParser();

    configureMarkdownParserForDocument(lute, markdown);
    const rendered = lute.Md2VditorDOM(markdown);

    expect(rendered).toContain('---aaa---');
    expect(rendered).toContain('<strong data-marker="**">123</strong>');
    expect(rendered).not.toContain('yaml-front-matter');
  });

  it('does not let an unclosed front matter block consume the document', () => {
    const markdown = '---\ntitle: unfinished\n**still parsed**';
    const lute = createTestLuteParser();

    expect(
      configureMarkdownParserForDocument(lute, markdown),
    ).toEqual([
      {
        feature: 'yaml-front-matter',
        mode: 'literal-fallback',
        reason: 'unterminated',
      },
    ]);
    const rendered = lute.Md2VditorDOM(markdown);
    expect(rendered).toContain('title: unfinished');
    expect(rendered).toContain(
      '<strong data-marker="**">still parsed</strong>',
    );
  });

  it('keeps complete front matter enabled', () => {
    const markdown =
      '---  \r\ntitle: valid\r\n---\t\r\n**123**';
    const lute = createTestLuteParser();

    expect(
      configureMarkdownParserForDocument(lute, markdown),
    ).toEqual([
      {
        feature: 'yaml-front-matter',
        mode: 'render',
      },
    ]);
    const rendered = lute.Md2VditorDOM(markdown);
    expect(rendered).toContain('yaml-front-matter');
    expect(rendered).toContain('<strong data-marker="**">123</strong>');
  });

  it('falls back literally when the active renderer lacks the feature', () => {
    expect(
      configureMarkdownParserForDocument(
        {},
        '---\ntitle: valid\n---\n**123**',
      ),
    ).toEqual([
      {
        feature: 'yaml-front-matter',
        mode: 'literal-fallback',
        reason: 'renderer-unavailable',
      },
    ]);
  });

  it('keeps unrelated documents outside optional feature parsing', () => {
    const controller = {
      SetYamlFrontMatter: vi.fn(),
    };

    expect(
      configureMarkdownParserForDocument(
        controller,
        '# title\n\n**123**',
      ),
    ).toEqual([
      {
        feature: 'yaml-front-matter',
        mode: 'inactive',
      },
    ]);
    expect(controller.SetYamlFrontMatter).toHaveBeenCalledWith(false);
  });

  it('does not mistake a longer thematic break for front matter', () => {
    expect(
      configureMarkdownParserForDocument(
        { SetYamlFrontMatter: vi.fn() },
        '----\n\n**123**',
      ),
    ).toEqual([
      {
        feature: 'yaml-front-matter',
        mode: 'inactive',
      },
    ]);
  });
});

describe('MarkdownEditorInputGate', () => {
  it('blocks delayed input until editor initialization finishes', () => {
    const gate = new MarkdownEditorInputGate();

    expect(gate.canForward()).toBe(false);
    gate.completeInitialization();
    expect(gate.canForward()).toBe(true);
  });

  it('keeps programmatic setValue input suppressed independently', () => {
    const gate = new MarkdownEditorInputGate();
    gate.completeInitialization();
    const release = gate.suppress();

    expect(gate.canForward()).toBe(false);
    release();
    expect(gate.canForward()).toBe(true);
    expect(gate.canForward(true)).toBe(false);
  });

  it('allows only credential-free HTTP(S) external links', () => {
    expect(
      isSafeMarkdownExternalLink('https://example.com/guide'),
    ).toBe(true);
    expect(
      isSafeMarkdownExternalLink('https://user:secret@example.com'),
    ).toBe(false);
    expect(isSafeMarkdownExternalLink('javascript:alert(1)')).toBe(
      false,
    );
    expect(isSafeMarkdownExternalLink('../private.md')).toBe(false);
  });

  it('only embeds renderer-owned or inline image sources', () => {
    expect(
      isMarkdownEmbeddedImageSourceAllowed(
        'learning-content://session/image.png',
      ),
    ).toBe(true);
    expect(
      isMarkdownEmbeddedImageSourceAllowed(
        'data:image/png;base64,c2FmZQ==',
      ),
    ).toBe(true);
    expect(
      isMarkdownEmbeddedImageSourceAllowed(
        'https://example.com/image.png',
      ),
    ).toBe(false);
    expect(
      isMarkdownEmbeddedImageSourceAllowed('../image.png'),
    ).toBe(false);
  });

  it('disables remote media embedding and PlantUML network rendering', () => {
    expect(MARKDOWN_PREVIEW_RENDER_POLICY).toEqual({
      media: { enable: false },
    });
    expect(isMarkdownNetworkRendererAllowed('plantuml')).toBe(false);
    expect(isMarkdownNetworkRendererAllowed('mermaid')).toBe(true);
  });
});

describe('MarkdownEditorAdapter initialization lifecycle', () => {
  it('resolves create only after Vditor after and the ready frame', async () => {
    const harness = createEditorHarness();
    const creation = MarkdownEditorAdapter.create(
      createEditorOptions(),
      harness.dependencies,
    );
    let settled = false;
    void creation.then(() => {
      settled = true;
    });
    await vi.waitFor(() =>
      expect(harness.dependencies.createEditor).toHaveBeenCalledOnce(),
    );

    harness.triggerAfter();
    await Promise.resolve();
    expect(settled).toBe(false);
    harness.triggerFrame();

    const adapter = await creation;
    expect(settled).toBe(true);
    expect(harness.editor.setValue).toHaveBeenCalledWith(
      '# 初始内容',
      true,
    );
    adapter.destroy();
  });

  it('destroys a pending editor when its initialization is aborted', async () => {
    const controller = new AbortController();
    const harness = createEditorHarness();
    const creation = MarkdownEditorAdapter.create(
      createEditorOptions(controller.signal),
      harness.dependencies,
    );
    await vi.waitFor(() =>
      expect(harness.dependencies.createEditor).toHaveBeenCalledOnce(),
    );
    harness.triggerAfter();
    await Promise.resolve();

    controller.abort();

    await expect(creation).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(harness.dependencies.cancelFrame).toHaveBeenCalledWith(7);
    expect(harness.editor.destroy).toHaveBeenCalledOnce();
  });

  it('turns an asynchronous Vditor initialization error into a rejected create', async () => {
    const failure = new Error('Vditor after failed');
    const harness = createEditorHarness({
      initializationError: failure,
    });
    const creation = MarkdownEditorAdapter.create(
      createEditorOptions(),
      harness.dependencies,
    );
    await vi.waitFor(() =>
      expect(harness.dependencies.createEditor).toHaveBeenCalledOnce(),
    );

    harness.triggerAfter();

    await expect(creation).rejects.toBe(failure);
    expect(harness.editor.destroy).toHaveBeenCalledOnce();
  });

  it('fails visibly instead of waiting forever when Vditor never becomes ready', async () => {
    const harness = createEditorHarness();
    const creation = MarkdownEditorAdapter.create(
      {
        ...createEditorOptions(),
        readyTimeoutMs: 10,
      },
      harness.dependencies,
    );

    await expect(creation).rejects.toThrow(
      'Markdown 可视化编辑器初始化超时',
    );
    expect(harness.editor.destroy).toHaveBeenCalledOnce();
  });

  it('inserts Markdown text through Vditor', async () => {
    const harness = createEditorHarness();
    const creation = MarkdownEditorAdapter.create(
      createEditorOptions(),
      harness.dependencies,
    );
    await vi.waitFor(() =>
      expect(harness.dependencies.createEditor).toHaveBeenCalledOnce(),
    );
    harness.triggerAfter();
    await Promise.resolve();
    harness.triggerFrame();
    const adapter = await creation;

    adapter.insertMarkdown('![图](images/a.png)');

    expect(harness.editor.insertValue).toHaveBeenCalledWith(
      '![图](images/a.png)',
    );
    adapter.destroy();
  });

  it('resolves same-directory image sources to data URLs', async () => {
    const harness = createEditorHarness();
    const localImage = {
      dataset: {} as Record<string, unknown>,
      alt: '',
      title: '',
      isConnected: true,
      getAttribute: vi.fn(() => 'images/shot.png'),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const externalImage = {
      dataset: {} as Record<string, unknown>,
      alt: '',
      title: '',
      isConnected: true,
      getAttribute: vi.fn(() => 'https://example.com/x.png'),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const element = harness.editor.vditor.wysiwyg?.element as
      | {
          querySelectorAll: ReturnType<typeof vi.fn>;
        }
      | undefined;
    if (!element) throw new Error('missing wysiwyg element');
    element.querySelectorAll = vi.fn(() => [
      localImage,
      externalImage,
    ]);
    const readLocalImageSource = vi.fn(
      async () => 'data:image/png;base64,YQ==',
    );
    const creation = MarkdownEditorAdapter.create(
      {
        ...createEditorOptions(),
        readLocalImageSource,
      },
      harness.dependencies,
    );
    await vi.waitFor(() =>
      expect(harness.dependencies.createEditor).toHaveBeenCalledOnce(),
    );
    harness.triggerAfter();
    await Promise.resolve();
    harness.triggerFrame();
    const adapter = await creation;

    await vi.waitFor(() =>
      expect(readLocalImageSource).toHaveBeenCalledWith(
        'images/shot.png',
      ),
    );
    await vi.waitFor(() =>
      expect(localImage.setAttribute).toHaveBeenCalledWith(
        'src',
        'data:image/png;base64,YQ==',
      ),
    );
    expect(localImage.setAttribute).toHaveBeenCalledWith(
      'data-md-src',
      'images/shot.png',
    );
    expect(localImage.dataset.blockedSource).toBeUndefined();
    expect(externalImage.dataset.blockedSource).toBe('true');
    adapter.destroy();
  });

  it('keeps relative images blocked when no local resolver is available', async () => {
    const harness = createEditorHarness();
    const image = {
      dataset: {} as Record<string, unknown>,
      alt: '',
      title: '',
      isConnected: true,
      getAttribute: vi.fn(() => 'images/blocked.png'),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const element = harness.editor.vditor.wysiwyg?.element as
      | {
          querySelectorAll: ReturnType<typeof vi.fn>;
        }
      | undefined;
    if (!element) throw new Error('missing wysiwyg element');
    element.querySelectorAll = vi.fn(() => [image]);
    const creation = MarkdownEditorAdapter.create(
      createEditorOptions(),
      harness.dependencies,
    );
    await vi.waitFor(() =>
      expect(harness.dependencies.createEditor).toHaveBeenCalledOnce(),
    );
    harness.triggerAfter();
    await Promise.resolve();
    harness.triggerFrame();
    const adapter = await creation;

    expect(image.dataset.blockedSource).toBe('true');
    adapter.destroy();
  });

  it('restores relative image paths when serializing WYSIWYG Markdown', async () => {
    const harness = createEditorHarness();
    const image = {
      dataset: {} as Record<string, unknown>,
      alt: '',
      title: '',
      isConnected: true,
      getAttribute: vi.fn((name: string) =>
        name === 'src'
          ? 'data:image/png;base64,AAAA'
          : name === 'data-md-src'
            ? 'images/shot.png'
            : '',
      ),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const element = harness.editor.vditor.wysiwyg?.element as
      | {
          querySelectorAll: ReturnType<typeof vi.fn>;
        }
      | undefined;
    if (!element) throw new Error('missing wysiwyg element');
    element.querySelectorAll = vi.fn(() => [image]);
    const creation = MarkdownEditorAdapter.create(
      createEditorOptions(),
      harness.dependencies,
    );
    await vi.waitFor(() =>
      expect(harness.dependencies.createEditor).toHaveBeenCalledOnce(),
    );
    harness.triggerAfter();
    await Promise.resolve();
    harness.triggerFrame();
    const adapter = await creation;

    expect(
      adapter.normalizeImageSourcesForSource(
        '开头 ![图](data:image/png;base64,AAAA) 结尾',
      ),
    ).toBe('开头 ![图](images/shot.png) 结尾');
    adapter.destroy();
  });
});
