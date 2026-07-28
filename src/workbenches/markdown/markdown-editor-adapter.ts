import Vditor from 'vditor';

export interface MarkdownEditorAdapterOptions {
  readonly host: HTMLElement;
  readonly initialValue: string;
  readonly initialScrollTop: number;
  readonly outlineVisible: boolean;
  readonly resourceBaseUrl?: string;
  readonly onReady: () => void;
  readonly onInput: (value: string) => void;
  readonly onScroll: (scrollTop: number) => void;
  readonly onOpenExternal: (url: string) => void;
  readonly onError: (error: unknown) => void;
  readonly signal?: AbortSignal;
}

type MermaidRuntime = {
  initialize(options: Record<string, unknown>): void;
};

type StrictMermaidRuntime = MermaidRuntime & {
  __learningCompanionStrict?: true;
};

let mermaidRuntimePromise: Promise<void> | undefined;
let iconRuntimePromise: Promise<void> | undefined;

export const MARKDOWN_PREVIEW_RENDER_POLICY = Object.freeze({
  media: Object.freeze({ enable: false }),
});

export function isMarkdownNetworkRendererAllowed(
  language: string,
): boolean {
  return language.trim().toLowerCase() !== 'plantuml';
}

export class MarkdownEditorInputGate {
  private initializationComplete = false;
  private suppressionDepth = 0;

  canForward(destroyed = false): boolean {
    return (
      this.initializationComplete &&
      this.suppressionDepth === 0 &&
      !destroyed
    );
  }

  completeInitialization(): void {
    this.initializationComplete = true;
  }

  suppress(): () => void {
    this.suppressionDepth += 1;
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.suppressionDepth = Math.max(0, this.suppressionDepth - 1);
    };
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveVditorResourceBaseUrl(
  baseUri: string = document.baseURI,
): string {
  return trimTrailingSlash(new URL('vendor/vditor/', baseUri).toString());
}

function getMermaidRuntime(): StrictMermaidRuntime | undefined {
  const candidate = (
    globalThis as typeof globalThis & {
      mermaid?: StrictMermaidRuntime;
    }
  ).mermaid;

  return candidate;
}

function enforceStrictMermaidRuntime(): void {
  const runtime = getMermaidRuntime();

  if (!runtime || runtime.__learningCompanionStrict) {
    return;
  }

  const initialize = runtime.initialize.bind(runtime);
  runtime.initialize = (options) => {
    const flowchart =
      typeof options.flowchart === 'object' &&
      options.flowchart !== null &&
      !Array.isArray(options.flowchart)
        ? (options.flowchart as Record<string, unknown>)
        : {};

    initialize({
      ...options,
      securityLevel: 'strict',
      flowchart: {
        ...flowchart,
        htmlLabels: false,
      },
    });
  };
  runtime.__learningCompanionStrict = true;
}

function installPlantUmlNetworkGuard(): void {
  const scriptId = 'vditorPlantumlScript';

  if (!document.getElementById(scriptId)) {
    const marker = document.createElement('meta');
    marker.id = scriptId;
    document.head.appendChild(marker);
  }

  (
    globalThis as typeof globalThis & {
      plantumlEncoder?: { encode(value: string): string };
    }
  ).plantumlEncoder = {
    encode() {
      throw new Error(
        'PlantUML 网络渲染在 Learning Companion 中已禁用',
      );
    },
  };
}

function loadLocalIconRuntime(resourceBaseUrl: string): Promise<void> {
  if (document.getElementById('vditorIconScript')) {
    return Promise.resolve();
  }

  if (document.getElementById('vditor-icon-bold')) {
    const marker = document.createElement('meta');
    marker.id = 'vditorIconScript';
    document.head.appendChild(marker);
    return Promise.resolve();
  }

  if (iconRuntimePromise) {
    return iconRuntimePromise;
  }

  iconRuntimePromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = 'vditorIconScript';
    script.async = true;
    script.src = `${trimTrailingSlash(resourceBaseUrl)}/dist/js/icons/ant.js`;
    script.addEventListener(
      'load',
      () => {
        iconRuntimePromise = undefined;
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => {
        script.remove();
        iconRuntimePromise = undefined;
        reject(new Error('Vditor 本地图标资源加载失败'));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  return iconRuntimePromise;
}

function loadLocalMermaidRuntime(resourceBaseUrl: string): Promise<void> {
  if (getMermaidRuntime()) {
    enforceStrictMermaidRuntime();
    return Promise.resolve();
  }

  if (mermaidRuntimePromise) {
    return mermaidRuntimePromise;
  }

  mermaidRuntimePromise = new Promise<void>((resolve, reject) => {
    const scriptId = 'vditorMermaidScript';
    const existing = document.getElementById(
      scriptId,
    ) as HTMLScriptElement | null;
    const finish = () => {
      if (!getMermaidRuntime()) {
        reject(new Error('Mermaid 本地运行资源加载失败'));
        return;
      }

      enforceStrictMermaidRuntime();
      resolve();
    };

    if (existing) {
      if (getMermaidRuntime()) {
        finish();
      } else {
        existing.addEventListener('load', finish, { once: true });
        existing.addEventListener(
          'error',
          () => reject(new Error('Mermaid 本地运行资源加载失败')),
          { once: true },
        );
      }
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.async = true;
    script.src = `${trimTrailingSlash(resourceBaseUrl)}/dist/js/mermaid/mermaid.min.js?v=11.6.0`;
    script.addEventListener('load', finish, { once: true });
    script.addEventListener(
      'error',
      () => {
        script.remove();
        mermaidRuntimePromise = undefined;
        reject(new Error('Mermaid 本地运行资源加载失败'));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  return mermaidRuntimePromise;
}

export function isSafeMarkdownExternalLink(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

export function isMarkdownEmbeddedImageSourceAllowed(
  value: string,
): boolean {
  return (
    value.startsWith('data:image/') ||
    value.startsWith('learning-content:')
  );
}

function sanitizeUrlAttribute(
  element: Element,
  attribute: 'href' | 'src' | 'xlink:href',
): void {
  const value = element.getAttribute(attribute);

  if (!value) {
    return;
  }

  if (
    value.startsWith('#') ||
    value.startsWith('data:image/') ||
    isSafeMarkdownExternalLink(value)
  ) {
    return;
  }

  element.removeAttribute(attribute);
}

export function sanitizeMarkdownRenderedHtml(html: string): string {
  const documentFragment = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    'text/html',
  );
  const body = documentFragment.body;

  body
    .querySelectorAll(
      'script, iframe, object, embed, form, input, textarea, select, button',
    )
    .forEach((element) => element.remove());

  body.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();

      if (name.startsWith('on') || name === 'srcdoc') {
        element.removeAttribute(attribute.name);
      }
    }

    sanitizeUrlAttribute(element, 'href');
    sanitizeUrlAttribute(element, 'src');
    sanitizeUrlAttribute(element, 'xlink:href');

    if (element instanceof HTMLImageElement) {
      const source = element.getAttribute('src');

      if (
        source &&
        !isMarkdownEmbeddedImageSourceAllowed(source)
      ) {
        element.removeAttribute('src');
        element.removeAttribute('srcset');
        element.dataset.blockedSource = 'true';
        element.alt =
          element.alt || '外部或相对路径图片已阻止自动加载';
      }
    }
  });

  return body.innerHTML;
}

export class MarkdownEditorAdapter {
  private readonly editor: Vditor;
  private readonly onInput: (value: string) => void;
  private readonly onScroll: (scrollTop: number) => void;
  private readonly scrollListener: () => void;
  private readonly inputGate = new MarkdownEditorInputGate();
  private blockedImageObserver: MutationObserver | undefined;
  private destroyed = false;

  static async create(
    options: MarkdownEditorAdapterOptions,
  ): Promise<MarkdownEditorAdapter> {
    const resourceBaseUrl =
      options.resourceBaseUrl ?? resolveVditorResourceBaseUrl();
    options.signal?.throwIfAborted();
    await Promise.all([
      loadLocalIconRuntime(resourceBaseUrl),
      loadLocalMermaidRuntime(resourceBaseUrl),
    ]);
    options.signal?.throwIfAborted();
    installPlantUmlNetworkGuard();
    return new MarkdownEditorAdapter(options, resourceBaseUrl);
  }

  private constructor(
    options: MarkdownEditorAdapterOptions,
    resourceBaseUrl: string,
  ) {
    this.onInput = options.onInput;
    this.onScroll = options.onScroll;
    this.scrollListener = () => {
      this.onScroll(this.getScrollTop());
    };

    this.editor = new Vditor(options.host, {
      value: options.initialValue,
      mode: 'wysiwyg',
      height: '100%',
      minHeight: 0,
      width: '100%',
      lang: 'zh_CN',
      theme: 'dark',
      cdn: resourceBaseUrl,
      cache: { enable: false },
      resize: { enable: false },
      counter: { enable: false },
      outline: {
        enable: options.outlineVisible,
        position: 'left',
      },
      toolbar: [
        'headings',
        'bold',
        'italic',
        'strike',
        'link',
        '|',
        'list',
        'ordered-list',
        'check',
        'quote',
        'line',
        'code',
        'inline-code',
        'table',
        '|',
        'undo',
        'redo',
      ],
      toolbarConfig: { pin: true },
      link: {
        isOpen: false,
        click: (element) => {
          const href = element.getAttribute('href')?.trim();

          if (href && isSafeMarkdownExternalLink(href)) {
            options.onOpenExternal(href);
          }
        },
      },
      image: { isPreview: false },
      preview: {
        delay: 160,
        maxWidth: 880,
        mode: 'editor',
        actions: [],
        theme: {
          current: 'dark',
        },
        hljs: {
          enable: true,
          lineNumber: false,
          style: 'github-dark',
        },
        math: {
          engine: 'KaTeX',
          inlineDigit: true,
        },
        markdown: {
          autoSpace: false,
          fixTermTypo: false,
          footnotes: true,
          codeBlockPreview: true,
          mathBlockPreview: true,
          sanitize: true,
          mark: true,
          gfmAutoLink: true,
        },
        render: MARKDOWN_PREVIEW_RENDER_POLICY,
        transform: sanitizeMarkdownRenderedHtml,
      },
      input: (value) => {
        if (!this.inputGate.canForward(this.destroyed)) {
          return;
        }

        this.onInput(value);
      },
      after: () => {
        if (this.destroyed) {
          return;
        }

        this.editor.disabledCache();
        this.setOutlineVisible(options.outlineVisible);
        const scrollElement = this.getScrollElement();
        scrollElement?.addEventListener('scroll', this.scrollListener, {
          passive: true,
        });
        this.markBlockedImages();
        this.blockedImageObserver = new MutationObserver(() => {
          this.markBlockedImages();
        });
        const wysiwygElement = this.editor.vditor.wysiwyg?.element;
        if (wysiwygElement) {
          this.blockedImageObserver.observe(wysiwygElement, {
            attributes: true,
            attributeFilter: ['src', 'srcset', 'data-src'],
            childList: true,
            subtree: true,
          });
        }

        requestAnimationFrame(() => {
          if (this.destroyed) {
            return;
          }

          this.setScrollTop(options.initialScrollTop);
          this.inputGate.completeInitialization();
          options.onReady();
        });
      },
      esc: () => {
        this.editor.blur();
      },
    });
  }

  getValue(): string {
    return this.editor.getValue();
  }

  setValue(value: string): void {
    const release = this.inputGate.suppress();
    this.editor.setValue(value, true);
    queueMicrotask(() => {
      if (!this.destroyed) {
        release();
      }
    });
  }

  focus(): void {
    this.editor.focus();
  }

  getEditableElement(): HTMLElement | undefined {
    return this.editor.vditor.wysiwyg?.element;
  }

  canUndo(): boolean {
    return this.isToolbarActionEnabled('undo');
  }

  canRedo(): boolean {
    return this.isToolbarActionEnabled('redo');
  }

  undo(): void {
    this.editor.vditor.undo?.undo(this.editor.vditor);
  }

  redo(): void {
    this.editor.vditor.undo?.redo(this.editor.vditor);
  }

  deleteSelection(): void {
    this.editor.deleteValue();
  }

  insertPlainText(value: string): void {
    if (!document.execCommand('insertText', false, value)) {
      throw new Error('Markdown 编辑器无法插入剪贴板文字');
    }
  }

  selectAll(): void {
    const element = this.getEditableElement();

    if (!element) {
      throw new Error('Markdown 可视化编辑器尚未准备完成');
    }

    const range = document.createRange();
    range.selectNodeContents(element);
    element.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  scrollBy(left: number, top: number): void {
    this.getScrollElement()?.scrollBy({ left, top });
  }

  setOutlineVisible(visible: boolean): void {
    const state = this.editor.vditor;
    state.options.outline = {
      enable: visible,
      position: 'left',
    };
    state.outline.toggle(state, visible, false);
  }

  getScrollTop(): number {
    return Math.max(0, this.getScrollElement()?.scrollTop ?? 0);
  }

  setScrollTop(scrollTop: number): void {
    const element = this.getScrollElement();

    if (element) {
      element.scrollTop = Math.max(0, scrollTop);
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.blockedImageObserver?.disconnect();
    this.blockedImageObserver = undefined;
    this.getScrollElement()?.removeEventListener(
      'scroll',
      this.scrollListener,
    );
    this.editor.destroy();
    if (
      !document.getElementById('vditorIconScript') &&
      document.getElementById('vditor-icon-bold')
    ) {
      const marker = document.createElement('meta');
      marker.id = 'vditorIconScript';
      document.head.appendChild(marker);
    }
  }

  private getScrollElement(): HTMLElement | undefined {
    return this.editor.vditor.wysiwyg?.element;
  }

  private isToolbarActionEnabled(action: 'undo' | 'redo'): boolean {
    const element =
      this.editor.vditor.toolbar?.elements?.[action]?.firstElementChild;

    return (
      element instanceof HTMLElement &&
      !element.classList.contains('vditor-menu--disabled')
    );
  }

  private markBlockedImages(): void {
    this.editor.vditor.wysiwyg?.element
      .querySelectorAll<HTMLImageElement>('img')
      .forEach((image) => {
        const source =
          image.getAttribute('src') ??
          image.getAttribute('data-src') ??
          '';

        if (
          source.length === 0 ||
          isMarkdownEmbeddedImageSourceAllowed(source)
        ) {
          delete image.dataset.blockedSource;
          return;
        }

        image.dataset.blockedSource = 'true';
        image.title = '外部或相对路径图片已阻止自动加载';
        image.alt =
          image.alt || '外部或相对路径图片已阻止自动加载';
      });
  }
}
