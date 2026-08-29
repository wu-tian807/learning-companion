import Vditor from 'vditor';

import {
  markdownRuntimeLoader,
  type MarkdownRuntimeLoaderApi,
} from './markdown-runtime-loader';

export interface MarkdownEditorAdapterOptions {
  readonly host: HTMLElement;
  readonly initialValue: string;
  readonly initialScrollTop: number;
  readonly outlineVisible: boolean;
  readonly resourceBaseUrl?: string;
  readonly readyTimeoutMs?: number;
  readonly onInput: (value: string) => void;
  readonly onScroll: (scrollTop: number) => void;
  readonly onOpenExternal: (url: string) => void;
  readonly onError: (error: unknown) => void;
  readonly signal?: AbortSignal;
}

type VditorOptions = NonNullable<
  ConstructorParameters<typeof Vditor>[1]
>;

export interface MarkdownEditorAdapterDependencies {
  readonly runtimeLoader: MarkdownRuntimeLoaderApi;
  readonly createEditor: (
    host: HTMLElement,
    options: VditorOptions,
  ) => Vditor;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
}

const DEFAULT_READY_TIMEOUT_MS = 10_000;

const defaultEditorDependencies: MarkdownEditorAdapterDependencies = {
  runtimeLoader: markdownRuntimeLoader,
  createEditor: (host, options) => new Vditor(host, options),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

export const MARKDOWN_PREVIEW_RENDER_POLICY = Object.freeze({
  media: Object.freeze({ enable: false }),
});

interface MarkdownParserFeatureController {
  SetYamlFrontMatter?(enabled: boolean): void;
}

const YAML_FRONT_MATTER_DELIMITER = /^---[ \t]*$/;
const YAML_FRONT_MATTER_CANDIDATE = /^---(?:[^-]|$)/;

export type MarkdownParserFeatureMode =
  | 'inactive'
  | 'render'
  | 'literal-fallback';

export interface MarkdownParserFeatureDecision {
  readonly feature: string;
  readonly mode: MarkdownParserFeatureMode;
  readonly reason?:
    | 'malformed-opener'
    | 'unterminated'
    | 'renderer-unavailable';
}

interface MarkdownParserFeatureGuard {
  readonly feature: string;
  isRendererAvailable(controller: MarkdownParserFeatureController): boolean;
  inspect(
    markdown: string,
    rendererAvailable: boolean,
  ): MarkdownParserFeatureDecision;
  configure(
    controller: MarkdownParserFeatureController,
    decision: MarkdownParserFeatureDecision,
  ): void;
}

type MarkdownDelimitedFeatureInspection =
  | 'inactive'
  | 'malformed-opener'
  | 'unterminated'
  | 'complete';

function decideDelimitedMarkdownFeature(
  feature: string,
  inspection: MarkdownDelimitedFeatureInspection,
  rendererAvailable: boolean,
): MarkdownParserFeatureDecision {
  if (inspection === 'inactive') {
    return { feature, mode: 'inactive' };
  }

  if (inspection === 'malformed-opener' || inspection === 'unterminated') {
    return {
      feature,
      mode: 'literal-fallback',
      reason: inspection,
    };
  }

  return rendererAvailable
    ? { feature, mode: 'render' }
    : {
        feature,
        mode: 'literal-fallback',
        reason: 'renderer-unavailable',
      };
}

function inspectYamlFrontMatter(
  markdown: string,
): MarkdownDelimitedFeatureInspection {
  const lines = markdown.split(/\r\n|\n|\r/);
  const firstLine = lines[0] ?? '';

  if (!YAML_FRONT_MATTER_CANDIDATE.test(firstLine)) {
    return 'inactive';
  }

  if (!YAML_FRONT_MATTER_DELIMITER.test(firstLine)) {
    return 'malformed-opener';
  }

  const closed = lines
    .slice(1)
    .some((line) => YAML_FRONT_MATTER_DELIMITER.test(line));

  return closed ? 'complete' : 'unterminated';
}

// Optional extensions that can consume the rest of a document belong here.
// Each feature validates its own grammar and renderer capability before it is
// enabled; core Markdown blocks are intentionally left to the Markdown parser.
const MARKDOWN_PARSER_FEATURE_GUARDS: readonly MarkdownParserFeatureGuard[] =
  Object.freeze([
    {
      feature: 'yaml-front-matter',
      isRendererAvailable: (controller) =>
        typeof controller.SetYamlFrontMatter === 'function',
      inspect: (markdown, rendererAvailable) =>
        decideDelimitedMarkdownFeature(
          'yaml-front-matter',
          inspectYamlFrontMatter(markdown),
          rendererAvailable,
        ),
      configure: (controller, decision) => {
        controller.SetYamlFrontMatter?.(decision.mode === 'render');
      },
    },
  ]);

export function configureMarkdownParserForDocument(
  controller: MarkdownParserFeatureController,
  markdown: string,
): readonly MarkdownParserFeatureDecision[] {
  return Object.freeze(
    MARKDOWN_PARSER_FEATURE_GUARDS.map((guard) => {
      const decision = guard.inspect(
        markdown,
        guard.isRendererAvailable(controller),
      );
      guard.configure(controller, decision);
      return Object.freeze(decision);
    }),
  );
}

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
  private editor!: Vditor;
  private readonly dependencies: MarkdownEditorAdapterDependencies;
  private readonly onInput: (value: string) => void;
  private readonly onScroll: (scrollTop: number) => void;
  private readonly scrollListener: () => void;
  private readonly inputGate = new MarkdownEditorInputGate();
  private readonly readyTask: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: unknown) => void;
  private blockedImageObserver: MutationObserver | undefined;
  private readyFrame: number | undefined;
  private readySettled = false;
  private destroyed = false;

  static async create(
    options: MarkdownEditorAdapterOptions,
    dependencies: Partial<MarkdownEditorAdapterDependencies> = {},
  ): Promise<MarkdownEditorAdapter> {
    const resourceBaseUrl =
      options.resourceBaseUrl ?? resolveVditorResourceBaseUrl();
    const resolvedDependencies = {
      ...defaultEditorDependencies,
      ...dependencies,
    };
    await resolvedDependencies.runtimeLoader.load(
      resourceBaseUrl,
      options.signal,
    );
    const adapter = new MarkdownEditorAdapter(
      options,
      resourceBaseUrl,
      resolvedDependencies,
    );

    try {
      await adapter.waitUntilReady(
        options.signal,
        options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      );
      return adapter;
    } catch (error) {
      adapter.destroy();
      throw error;
    }
  }

  private constructor(
    options: MarkdownEditorAdapterOptions,
    resourceBaseUrl: string,
    dependencies: MarkdownEditorAdapterDependencies,
  ) {
    this.dependencies = dependencies;
    this.onInput = options.onInput;
    this.onScroll = options.onScroll;
    this.scrollListener = () => {
      this.onScroll(this.getScrollTop());
    };
    this.readyTask = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.editor = this.dependencies.createEditor(options.host, {
      // Lute must be configured before it sees the document. Otherwise a
      // malformed leading "---..." is treated as an unterminated YAML block
      // and consumes every following Markdown node.
      value: '',
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
      // Vditor 3.11.2 将该可选回调当作必填函数调用。
      customWysiwygToolbar: () => undefined,
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
        queueMicrotask(() => {
          this.completeInitialization(options);
        });
      },
      esc: () => {
        this.editor.blur();
      },
    });
  }

  private async waitUntilReady(
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0
    ) {
      throw new Error('Markdown 可视化编辑器 Ready 超时配置无效');
    }
    if (signal?.aborted) {
      throw new DOMException(
        'Markdown editor initialization cancelled',
        'AbortError',
      );
    }

    let onAbort: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        this.readyTask,
        new Promise<never>((_resolvePromise, rejectPromise) => {
          timeout = setTimeout(() => {
            rejectPromise(
              new Error('Markdown 可视化编辑器初始化超时'),
            );
          }, timeoutMs);
        }),
        ...(signal
          ? [
              new Promise<never>(
                (_resolvePromise, rejectPromise) => {
                  onAbort = () =>
                    rejectPromise(
                      new DOMException(
                        'Markdown editor initialization cancelled',
                        'AbortError',
                      ),
                    );
                  signal.addEventListener('abort', onAbort, {
                    once: true,
                  });
                },
              ),
            ]
          : []),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }

  private completeInitialization(
    options: MarkdownEditorAdapterOptions,
  ): void {
    if (this.destroyed || this.readySettled) {
      return;
    }

    try {
      this.editor.disabledCache();
      this.applyValue(options.initialValue);
      this.setOutlineVisible(options.outlineVisible);
      const scrollElement = this.getScrollElement();
      scrollElement?.addEventListener('scroll', this.scrollListener, {
        passive: true,
      });
      this.markBlockedImages();
      this.blockedImageObserver = new MutationObserver(() => {
        try {
          this.markBlockedImages();
        } catch (error) {
          options.onError(error);
        }
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

      this.readyFrame = this.dependencies.requestFrame(() => {
        this.readyFrame = undefined;
        if (this.destroyed || this.readySettled) {
          return;
        }

        try {
          this.setScrollTop(options.initialScrollTop);
          this.inputGate.completeInitialization();
          this.settleReady();
        } catch (error) {
          this.settleReady(error);
        }
      });
    } catch (error) {
      this.settleReady(error);
    }
  }

  private settleReady(error?: unknown): void {
    if (this.readySettled) {
      return;
    }

    this.readySettled = true;
    if (error === undefined) {
      this.resolveReady();
    } else {
      this.rejectReady(error);
    }
  }

  getValue(): string {
    return this.editor.getValue();
  }

  setValue(value: string): void {
    const release = this.inputGate.suppress();
    this.applyValue(value);
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

  getMarkdownForRange(range: Range): string {
    const element = this.getEditableElement();
    if (
      !element ||
      !element.contains(range.startContainer) ||
      !element.contains(range.endContainer)
    ) {
      throw new Error('Markdown 编辑器选区已经失效');
    }
    const container = element.ownerDocument.createElement('div');
    let contents: Node = range.cloneContents();
    const common = range.commonAncestorContainer;
    let ancestor = common.nodeType === 1
      ? common as Element
      : common.parentElement;
    while (ancestor && ancestor !== element) {
      const wrapper = ancestor.cloneNode(false);
      wrapper.appendChild(contents);
      contents = wrapper;
      ancestor = ancestor.parentElement;
    }
    container.appendChild(contents);
    return this.editor.vditor.lute
      .VditorDOM2Md(container.innerHTML)
      .trim();
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
    if (this.readyFrame !== undefined) {
      this.dependencies.cancelFrame(this.readyFrame);
      this.readyFrame = undefined;
    }
    this.settleReady(
      new DOMException(
        'Markdown editor initialization cancelled',
        'AbortError',
      ),
    );
    this.blockedImageObserver?.disconnect();
    this.blockedImageObserver = undefined;
    this.getScrollElement()?.removeEventListener(
      'scroll',
      this.scrollListener,
    );
    this.editor.destroy();
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

  private applyValue(value: string): void {
    configureMarkdownParserForDocument(
      this.editor.vditor
        .lute as unknown as MarkdownParserFeatureController,
      value,
    );
    this.editor.setValue(value, true);
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
