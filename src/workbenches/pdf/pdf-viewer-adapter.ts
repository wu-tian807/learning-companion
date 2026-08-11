import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist';
import type {
  EventBus as PdfJsEventBus,
  PDFFindController as PdfJsFindController,
  PDFViewer as PdfJsViewer,
} from 'pdfjs-dist/web/pdf_viewer.mjs';

import type { WorkbenchSelectionSnapshot } from '../../shared/workbench/selection';
import {
  clonePdfWorkbenchState,
  createPdfDocumentIdentity,
  createPdfPageTarget,
  createPdfTextRangeAnchor,
  createPdfTextRangeTarget,
  type PdfDocumentIdentity,
  type PdfReadingMode,
  type PdfRotation,
  type PdfScaleMode,
  type PdfSidebar,
  type PdfWorkbenchViewState,
} from './shared';
import { pdfjsLib, pdfjsViewer } from './pdfjs-runtime';

const {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  InvalidPDFException,
  PasswordResponses,
} = pdfjsLib;
const {
  EventBus,
  FindState,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  ScrollMode,
} = pdfjsViewer;

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const QUOTE_CONTEXT_LENGTH = 64;

export interface PdfAssetUrls {
  readonly workerSrc: string;
  readonly cMapUrl: string;
  readonly standardFontDataUrl: string;
  readonly wasmUrl: string;
  readonly iccUrl: string;
  readonly imageResourcesPath: string;
}

export interface PdfDocumentSummary {
  readonly pageCount: number;
  readonly documentIdentity: PdfDocumentIdentity;
  readonly hasOutline: boolean;
}

export interface PdfFindStatus {
  readonly state: 'idle' | 'pending' | 'found' | 'not-found' | 'wrapped';
  readonly current: number;
  readonly total: number;
}

export interface PdfPasswordRequest {
  readonly incorrect: boolean;
  readonly submit: (password: string) => void;
}

export interface PdfViewerError {
  readonly kind:
    | 'invalid-pdf'
    | 'password'
    | 'worker'
    | 'resource'
    | 'unsupported'
    | 'selection'
    | 'unknown';
  readonly message: string;
  readonly cause?: unknown;
}

export interface PdfOutlineItem {
  readonly id: string;
  readonly title: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly destination: string | readonly unknown[] | null;
  readonly externalUrl?: string;
  readonly items: readonly PdfOutlineItem[];
}

export interface PdfViewerAdapterEvents {
  readonly onReady: (summary: PdfDocumentSummary) => void;
  readonly onProgress: (percent: number | undefined) => void;
  readonly onViewStateChange: (state: PdfWorkbenchViewState) => void;
  readonly onSelectionChange: (
    selection: WorkbenchSelectionSnapshot | undefined,
  ) => void;
  readonly onFindStatusChange: (status: PdfFindStatus) => void;
  readonly onPasswordRequest: (request: PdfPasswordRequest) => void;
  readonly onError: (error: PdfViewerError) => void;
}

export interface PdfViewerAdapterOptions {
  readonly container: HTMLDivElement;
  readonly viewer: HTMLDivElement;
  readonly contentUrl: string;
  readonly initialState: PdfWorkbenchViewState;
  readonly assetUrls: PdfAssetUrls;
  readonly events: PdfViewerAdapterEvents;
  readonly onOpenExternal: (url: string) => Promise<void> | void;
}

export interface PdfSelectionSegment {
  readonly pageNumber: number;
  readonly pageText: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

interface PageTextIndex {
  readonly pageNumber: number;
  readonly text: string;
  readonly resolveBoundary: (
    container: Node,
    offset: number,
  ) => number | undefined;
}

interface PdfJsFindEvent {
  readonly state?: number;
  readonly matchesCount?: {
    readonly current?: number;
    readonly total?: number;
  };
}

interface PdfJsViewAreaEvent {
  readonly location?: {
    readonly pageNumber?: number;
  };
}

interface PdfJsPageEvent {
  readonly pageNumber?: number;
}

interface PdfJsScaleEvent {
  readonly scale?: number;
  readonly presetValue?: string;
}

interface PdfJsRotationEvent {
  readonly pagesRotation?: number;
}

interface PdfJsScrollModeEvent {
  readonly mode?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function normalizeRotation(rotation: number): PdfRotation {
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;

  if (
    normalized === 0 ||
    normalized === 90 ||
    normalized === 180 ||
    normalized === 270
  ) {
    return normalized;
  }

  return 0;
}

export function isSafePdfExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function displayExternalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value;
  }
}

function scaleModeFromPdfJs(
  presetValue: string | undefined,
): PdfScaleMode {
  if (presetValue === 'page-width') {
    return 'page-width';
  }
  if (presetValue === 'page-fit') {
    return 'page-fit';
  }
  if (presetValue === 'page-actual') {
    return 'actual-size';
  }
  return 'custom';
}

function pdfJsScaleValue(mode: PdfScaleMode, scale: number): string {
  if (mode === 'actual-size') {
    return 'page-actual';
  }
  if (mode === 'custom') {
    return String(clamp(scale, MIN_SCALE, MAX_SCALE));
  }
  return mode;
}

function mapFindState(value: number | undefined): PdfFindStatus['state'] {
  if (value === FindState.PENDING) {
    return 'pending';
  }
  if (value === FindState.NOT_FOUND) {
    return 'not-found';
  }
  if (value === FindState.WRAPPED) {
    return 'wrapped';
  }
  if (value === FindState.FOUND) {
    return 'found';
  }
  return 'idle';
}

function mapLoadError(error: unknown): PdfViewerError {
  if (error instanceof InvalidPDFException) {
    return {
      kind: 'invalid-pdf',
      message: '文件不是有效的 PDF，或者内容已经损坏。',
      cause: error,
    };
  }

  const message =
    error instanceof Error ? error.message : 'PDF 加载失败';
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('password')) {
    return {
      kind: 'password',
      message: '无法使用提供的密码打开 PDF。',
      cause: error,
    };
  }
  if (lowerMessage.includes('worker')) {
    return {
      kind: 'worker',
      message: 'PDF 阅读组件初始化失败。',
      cause: error,
    };
  }
  if (
    lowerMessage.includes('fetch') ||
    lowerMessage.includes('network') ||
    lowerMessage.includes('missing')
  ) {
    return {
      kind: 'resource',
      message: '无法读取 PDF 内容或运行资源。',
      cause: error,
    };
  }
  if (lowerMessage.includes('unsupported')) {
    return {
      kind: 'unsupported',
      message: '这份 PDF 使用了当前暂不支持的特性。',
      cause: error,
    };
  }

  return {
    kind: 'unknown',
    message: 'PDF 加载失败，请刷新后重试。',
    cause: error,
  };
}

function toOutlineItems(
  nodes: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>,
  prefix = 'outline',
): readonly PdfOutlineItem[] {
  return (nodes ?? []).map((node, index) => ({
    id: `${prefix}-${index}`,
    title: node.title || '未命名章节',
    bold: node.bold,
    italic: node.italic,
    destination: node.dest,
    ...(node.url && isSafePdfExternalUrl(node.url)
      ? { externalUrl: node.url }
      : {}),
    items: toOutlineItems(node.items, `${prefix}-${index}`),
  }));
}

function getPageElement(
  node: Node,
  viewer: HTMLDivElement,
): HTMLElement | undefined {
  const element =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  const page = element?.closest<HTMLElement>('.page[data-page-number]');

  return page && viewer.contains(page) ? page : undefined;
}

function buildPageTextIndex(
  pageElement: HTMLElement,
): PageTextIndex | undefined {
  const pageNumber = Number(pageElement.dataset.pageNumber);
  const textLayer = pageElement.querySelector<HTMLElement>('.textLayer');

  if (!isPositiveInteger(pageNumber) || !textLayer) {
    return undefined;
  }

  const fullRange = textLayer.ownerDocument.createRange();
  fullRange.selectNodeContents(textLayer);
  const text = fullRange.toString();

  return {
    pageNumber,
    text,
    resolveBoundary(container, offset) {
      if (
        !isNonNegativeInteger(offset) ||
        (container !== textLayer && !textLayer.contains(container))
      ) {
        return undefined;
      }

      const maximumOffset =
        container.nodeType === Node.TEXT_NODE
          ? (container.nodeValue?.length ?? 0)
          : container.childNodes.length;

      if (offset > maximumOffset) {
        return undefined;
      }

      try {
        const prefixRange = textLayer.ownerDocument.createRange();
        prefixRange.setStart(textLayer, 0);
        prefixRange.setEnd(container, offset);
        return prefixRange.toString().length;
      } catch {
        return undefined;
      }
    },
  };
}

function pageOffsetRatio(
  container: HTMLDivElement,
  viewer: HTMLDivElement,
  pageNumber: number,
): number {
  const page = viewer.querySelector<HTMLElement>(
    `.page[data-page-number="${pageNumber}"]`,
  );

  if (!page || page.offsetHeight <= 0) {
    return 0;
  }

  return clamp(
    (container.scrollTop - page.offsetTop) / page.offsetHeight,
    0,
    1,
  );
}

export function resolvePdfAssetUrls(baseUrl: string): PdfAssetUrls {
  const resolve = (path: string) => new URL(path, baseUrl).toString();

  return {
    workerSrc: resolve('vendor/pdfjs/pdf.worker.min.mjs'),
    cMapUrl: resolve('vendor/pdfjs/cmaps/'),
    standardFontDataUrl: resolve('vendor/pdfjs/standard_fonts/'),
    wasmUrl: resolve('vendor/pdfjs/wasm/'),
    iccUrl: resolve('vendor/pdfjs/iccs/'),
    imageResourcesPath: resolve('vendor/pdfjs/images/'),
  };
}

export function createPdfDocumentLoadingParameters(
  contentUrl: string,
  assetUrls: PdfAssetUrls,
) {
  return {
    url: contentUrl,
    cMapUrl: assetUrls.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: assetUrls.standardFontDataUrl,
    wasmUrl: assetUrls.wasmUrl,
    iccUrl: assetUrls.iccUrl,
    disableRange: true,
    useWorkerFetch: false,
    enableXfa: false,
  } as const;
}

export function shouldClearCollapsedPdfSelection(
  isCollapsed: boolean,
  anchorInsideViewer: boolean,
): boolean {
  return isCollapsed && anchorInsideViewer;
}

export function normalizePdfSelectionText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function arePdfSelectionTextsEquivalent(
  indexedText: string,
  selectedText: string,
): boolean {
  const removeWhitespace = (value: string) =>
    value.normalize('NFC').replace(/\s+/gu, '');

  return (
    removeWhitespace(indexedText) === removeWhitespace(selectedText)
  );
}

export function createPdfSelectionSnapshotFromSegments(
  documentIdentity: PdfDocumentIdentity,
  rawSegments: readonly PdfSelectionSegment[],
  selectedText: string,
  readingMode: PdfReadingMode,
): WorkbenchSelectionSnapshot | undefined {
  const segments = [...rawSegments].sort(
    (left, right) => left.pageNumber - right.pageNumber,
  );

  if (
    segments.length === 0 ||
    !normalizePdfSelectionText(selectedText) ||
    (readingMode === 'paged' && segments.length !== 1)
  ) {
    return undefined;
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const previous = segments[index - 1];

    if (
      !isPositiveInteger(segment.pageNumber) ||
      !isNonNegativeInteger(segment.startOffset) ||
      !isNonNegativeInteger(segment.endOffset) ||
      segment.startOffset > segment.endOffset ||
      segment.endOffset > segment.pageText.length ||
      (previous &&
        segment.pageNumber !== previous.pageNumber + 1)
    ) {
      return undefined;
    }
  }

  const first = segments[0];
  const last = segments.at(-1)!;

  if (
    first.pageNumber === last.pageNumber &&
    first.startOffset === last.endOffset
  ) {
    return undefined;
  }

  const indexedText = segments
    .map((segment) =>
      segment.pageText.slice(segment.startOffset, segment.endOffset),
    )
    .join('\n');

  if (
    !arePdfSelectionTextsEquivalent(indexedText, selectedText)
  ) {
    return undefined;
  }

  const anchor = createPdfTextRangeAnchor({
    documentIdentity,
    start: {
      pageNumber: first.pageNumber,
      offset: first.startOffset,
    },
    end: {
      pageNumber: last.pageNumber,
      offset: last.endOffset,
    },
    quote: {
      exact: selectedText,
      prefix: first.pageText.slice(
        Math.max(0, first.startOffset - QUOTE_CONTEXT_LENGTH),
        first.startOffset,
      ),
      suffix: last.pageText.slice(
        last.endOffset,
        last.endOffset + QUOTE_CONTEXT_LENGTH,
      ),
    },
  });

  return {
    text: selectedText,
    target: createPdfTextRangeTarget(anchor),
  };
}

class ControlledPdfLinkService extends PDFLinkService {
  constructor(
    eventBus: PdfJsEventBus,
    private readonly openExternal: (
      url: string,
    ) => Promise<void> | void,
    private readonly reportError: (error: PdfViewerError) => void,
  ) {
    super({
      eventBus,
      externalLinkRel: 'noopener noreferrer nofollow',
    });
  }

  override addLinkAttributes(
    link: HTMLAnchorElement,
    url: string,
  ): void {
    const allowed = isSafePdfExternalUrl(url);
    link.href = '#';
    link.title = allowed
      ? displayExternalUrl(url)
      : '不支持打开此链接';
    link.rel = 'noopener noreferrer nofollow';
    link.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!allowed) {
        return false;
      }

      void Promise.resolve(this.openExternal(url)).catch((error) => {
        this.reportError({
          kind: 'resource',
          message: '无法在系统浏览器中打开链接。',
          cause: error,
        });
      });
      return false;
    };
  }
}

export class PdfViewerAdapter {
  private readonly eventBus = new EventBus();
  private readonly linkService: ControlledPdfLinkService;
  private readonly findController: PdfJsFindController;
  private readonly pdfViewer: PdfJsViewer;
  private readonly eventAbortController = new AbortController();
  private readonly thumbnailTasks = new Set<RenderTask>();
  private loadingTask: PDFDocumentLoadingTask | undefined;
  private pdfDocument: PDFDocumentProxy | undefined;
  private documentIdentity: PdfDocumentIdentity | undefined;
  private outline: readonly PdfOutlineItem[] = [];
  private state: PdfWorkbenchViewState;
  private currentQuery = '';
  private destroyed = false;
  private ready = false;
  private selectionTimer: number | undefined;

  constructor(private readonly options: PdfViewerAdapterOptions) {
    this.state = clonePdfWorkbenchState(options.initialState);
    this.linkService = new ControlledPdfLinkService(
      this.eventBus,
      options.onOpenExternal,
      options.events.onError,
    );
    this.findController = new PDFFindController({
      eventBus: this.eventBus,
      linkService: this.linkService,
      updateMatchesCountOnProgress: true,
    });
    const viewerOptions = {
      container: options.container,
      viewer: options.viewer,
      eventBus: this.eventBus,
      linkService: this.linkService,
      findController: this.findController,
      annotationMode: AnnotationMode.ENABLE,
      imageResourcesPath: options.assetUrls.imageResourcesPath,
      removePageBorders: false,
      enableSelectionRendering: true,
      enableAutoLinking: true,
      abortSignal: this.eventAbortController.signal,
    };
    this.pdfViewer = new PDFViewer(viewerOptions);
    this.linkService.setViewer(this.pdfViewer);
    this.bindEvents();
  }

  async start(): Promise<void> {
    if (this.destroyed || this.loadingTask) {
      return;
    }

    GlobalWorkerOptions.workerSrc = this.options.assetUrls.workerSrc;
    const loadingTask = getDocument(
      createPdfDocumentLoadingParameters(
        this.options.contentUrl,
        this.options.assetUrls,
      ),
    );
    this.loadingTask = loadingTask;
    loadingTask.onProgress = ({
      loaded,
      total,
    }: {
      loaded: number;
      total?: number;
    }) => {
      const percent =
        total && total > 0
          ? clamp((loaded / total) * 100, 0, 100)
          : undefined;
      this.options.events.onProgress(percent);
    };
    loadingTask.onPassword = (
      updatePassword: (password: string) => void,
      reason: number,
    ) => {
      this.options.events.onPasswordRequest({
        incorrect: reason === PasswordResponses.INCORRECT_PASSWORD,
        submit(password) {
          updatePassword(password);
        },
      });
    };

    try {
      const pdfDocument = await loadingTask.promise;

      if (this.destroyed) {
        await loadingTask.destroy();
        return;
      }

      const fingerprint = pdfDocument.fingerprints[0];

      if (!fingerprint) {
        throw new Error('PDF 文档缺少有效指纹');
      }

      this.pdfDocument = pdfDocument;
      this.documentIdentity = createPdfDocumentIdentity([
        fingerprint,
        pdfDocument.fingerprints[1] ?? null,
      ]);
      try {
        this.outline = toOutlineItems(await pdfDocument.getOutline());
      } catch (error) {
        console.warn(
          '[pdf-workbench] 文档目录读取失败，继续打开正文。',
          error,
        );
        this.outline = [];
      }
      this.linkService.setDocument(pdfDocument);
      this.findController.setDocument(pdfDocument);
      this.pdfViewer.setDocument(pdfDocument);
      await this.pdfViewer.firstPagePromise;

      if (this.destroyed) {
        return;
      }

      this.applyInitialState();
      this.ready = true;
      this.options.events.onProgress(100);
      this.options.events.onReady({
        pageCount: pdfDocument.numPages,
        documentIdentity: this.documentIdentity,
        hasOutline: this.outline.length > 0,
      });
      this.emitViewState();
    } catch (error) {
      if (!this.destroyed) {
        this.options.events.onError(mapLoadError(error));
      }
      (
        this.pdfViewer.setDocument as (
          document: PDFDocumentProxy | null,
        ) => void
      )(null);
      this.linkService.setDocument(null);
      (
        this.findController.setDocument as (
          document: PDFDocumentProxy | null,
        ) => void
      )(null);
      await loadingTask.destroy().catch((destroyError: unknown) => {
        console.warn(
          '[pdf-workbench] PDF 加载失败后的资源释放失败',
          destroyError,
        );
      });
      if (this.loadingTask === loadingTask) {
        this.loadingTask = undefined;
      }
      this.pdfDocument = undefined;
      this.documentIdentity = undefined;
      this.outline = [];
    }
  }

  getViewState(): PdfWorkbenchViewState {
    return clonePdfWorkbenchState(this.state);
  }

  getPageCount(): number {
    return this.pdfDocument?.numPages ?? 0;
  }

  getOutline(): readonly PdfOutlineItem[] {
    return this.outline;
  }

  getScalePercent(): number {
    return Math.round(this.state.customScale * 100);
  }

  refreshLayout(): void {
    if (!this.ready) {
      return;
    }

    if (this.state.scaleMode !== 'custom') {
      this.pdfViewer.currentScaleValue = pdfJsScaleValue(
        this.state.scaleMode,
        this.state.customScale,
      );
    }
    this.pdfViewer.update();
  }

  goToPage(pageNumber: number): void {
    const pageCount = this.getPageCount();

    if (!pageCount) {
      return;
    }

    this.pdfViewer.currentPageNumber = clamp(
      Math.round(pageNumber),
      1,
      pageCount,
    );
  }

  previousPage(): void {
    this.goToPage(this.state.pageNumber - 1);
  }

  nextPage(): void {
    this.goToPage(this.state.pageNumber + 1);
  }

  setReadingMode(readingMode: PdfReadingMode): void {
    if (this.state.readingMode === readingMode) {
      return;
    }

    const pageNumber = this.pdfViewer.currentPageNumber;
    this.pdfViewer.clearSelection();
    this.options.events.onSelectionChange(undefined);
    this.pdfViewer.scrollMode =
      readingMode === 'paged' ? ScrollMode.PAGE : ScrollMode.VERTICAL;
    this.state = {
      ...this.state,
      readingMode,
      pageNumber,
      pageOffsetRatio: 0,
    };
    this.pdfViewer.currentPageNumber = pageNumber;
    this.emitViewState();
  }

  setScaleMode(scaleMode: Exclude<PdfScaleMode, 'custom'>): void {
    this.pdfViewer.currentScaleValue = pdfJsScaleValue(
      scaleMode,
      this.state.customScale,
    );
  }

  setCustomScale(scale: number): void {
    this.pdfViewer.currentScaleValue = String(
      clamp(scale, MIN_SCALE, MAX_SCALE),
    );
  }

  zoomIn(origin?: readonly [number, number]): void {
    this.pdfViewer.updateScale({
      steps: 1,
      ...(origin ? { origin: [...origin] } : {}),
    });
  }

  zoomOut(origin?: readonly [number, number]): void {
    this.pdfViewer.updateScale({
      steps: -1,
      ...(origin ? { origin: [...origin] } : {}),
    });
  }

  rotate(delta: 90 | -90): void {
    this.pdfViewer.pagesRotation = normalizeRotation(
      this.pdfViewer.pagesRotation + delta,
    );
  }

  setSidebar(sidebar: PdfSidebar): void {
    if (this.state.sidebar === sidebar) {
      return;
    }

    this.state = { ...this.state, sidebar };
    this.emitViewState();
  }

  find(query: string): void {
    this.currentQuery = query;

    if (!query) {
      this.closeFind();
      return;
    }

    this.eventBus.dispatch('find', {
      source: this,
      type: '',
      query,
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: false,
      matchDiacritics: true,
    });
  }

  findAgain(previous: boolean): void {
    if (!this.currentQuery) {
      return;
    }

    this.eventBus.dispatch('find', {
      source: this,
      type: 'again',
      query: this.currentQuery,
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: true,
    });
  }

  closeFind(): void {
    this.currentQuery = '';
    this.eventBus.dispatch('findbarclose', { source: this });
    this.options.events.onFindStatusChange({
      state: 'idle',
      current: 0,
      total: 0,
    });
  }

  async activateOutlineItem(item: PdfOutlineItem): Promise<void> {
    if (item.externalUrl) {
      await this.options.onOpenExternal(item.externalUrl);
      return;
    }

    if (typeof item.destination === 'string') {
      await this.linkService.goToDestination(item.destination);
    } else if (Array.isArray(item.destination)) {
      await this.linkService.goToDestination([...item.destination]);
    }
  }

  async renderThumbnail(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    maximumWidth = 132,
  ): Promise<void> {
    const pdfDocument = this.pdfDocument;

    if (
      !pdfDocument ||
      pageNumber < 1 ||
      pageNumber > pdfDocument.numPages ||
      this.destroyed
    ) {
      return;
    }

    const page = await pdfDocument.getPage(pageNumber);

    if (this.destroyed) {
      return;
    }

    const initialViewport = page.getViewport({
      scale: 1,
      rotation: this.state.rotation,
    });
    const cssScale = Math.min(1, maximumWidth / initialViewport.width);
    const outputScale = Math.max(1, window.devicePixelRatio || 1);
    const viewport = page.getViewport({
      scale: cssScale * outputScale,
      rotation: this.state.rotation,
    });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${Math.floor(viewport.width / outputScale)}px`;
    canvas.style.height = `${Math.floor(viewport.height / outputScale)}px`;
    const task = page.render({ canvas, viewport });
    this.thumbnailTasks.add(task);

    try {
      await task.promise;
    } finally {
      this.thumbnailTasks.delete(task);
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.ready = false;
    this.eventAbortController.abort();
    document.removeEventListener(
      'selectionchange',
      this.handleSelectionChange,
    );

    if (this.selectionTimer !== undefined) {
      window.clearTimeout(this.selectionTimer);
      this.selectionTimer = undefined;
    }

    for (const task of this.thumbnailTasks) {
      task.cancel();
    }
    this.thumbnailTasks.clear();
    this.options.events.onSelectionChange(undefined);
    (
      this.pdfViewer.setDocument as (
        document: PDFDocumentProxy | null,
      ) => void
    )(null);
    this.linkService.setDocument(null);
    await this.loadingTask?.destroy();
    this.loadingTask = undefined;
    this.pdfDocument = undefined;
    this.documentIdentity = undefined;
    this.outline = [];
  }

  private bindEvents(): void {
    const signal = this.eventAbortController.signal;
    const on = (
      name: string,
      listener: (event: Record<string, unknown>) => void,
    ) => {
      this.eventBus.on(name, listener, { signal });
    };

    on('pagechanging', (event) => {
      const { pageNumber } = event as PdfJsPageEvent;

      if (!isPositiveInteger(pageNumber)) {
        return;
      }

      this.state = {
        ...this.state,
        pageNumber,
        pageOffsetRatio: pageOffsetRatio(
          this.options.container,
          this.options.viewer,
          pageNumber,
        ),
      };
      this.emitViewState();
    });
    on('updateviewarea', (event) => {
      const { location } = event as PdfJsViewAreaEvent;
      const pageNumber = location?.pageNumber;

      if (!isPositiveInteger(pageNumber)) {
        return;
      }

      this.state = {
        ...this.state,
        pageNumber,
        pageOffsetRatio: pageOffsetRatio(
          this.options.container,
          this.options.viewer,
          pageNumber,
        ),
      };
      this.emitViewState();
    });
    on('scalechanging', (event) => {
      const { scale, presetValue } = event as PdfJsScaleEvent;

      if (
        typeof scale !== 'number' ||
        !Number.isFinite(scale) ||
        scale <= 0
      ) {
        return;
      }

      this.state = {
        ...this.state,
        scaleMode: scaleModeFromPdfJs(presetValue),
        customScale: clamp(scale, MIN_SCALE, MAX_SCALE),
      };
      this.emitViewState();
    });
    on('rotationchanging', (event) => {
      const { pagesRotation } = event as PdfJsRotationEvent;

      if (typeof pagesRotation !== 'number') {
        return;
      }

      this.state = {
        ...this.state,
        rotation: normalizeRotation(pagesRotation),
      };
      this.options.events.onSelectionChange(undefined);
      this.emitViewState();
    });
    on('scrollmodechanged', (event) => {
      const { mode } = event as PdfJsScrollModeEvent;

      if (mode !== ScrollMode.PAGE && mode !== ScrollMode.VERTICAL) {
        return;
      }

      this.state = {
        ...this.state,
        readingMode:
          mode === ScrollMode.PAGE ? 'paged' : 'continuous',
        pageOffsetRatio: 0,
      };
      this.options.events.onSelectionChange(undefined);
      this.emitViewState();
    });
    const updateFindStatus = (event: Record<string, unknown>) => {
      const findEvent = event as PdfJsFindEvent;
      this.options.events.onFindStatusChange({
        state: mapFindState(findEvent.state),
        current: findEvent.matchesCount?.current ?? 0,
        total: findEvent.matchesCount?.total ?? 0,
      });
    };
    on('updatefindmatchescount', updateFindStatus);
    on('updatefindcontrolstate', updateFindStatus);

    this.options.container.addEventListener(
      'wheel',
      this.handleWheel,
      { passive: false, signal },
    );
    document.addEventListener(
      'selectionchange',
      this.handleSelectionChange,
      { signal },
    );
  }

  private readonly handleWheel = (event: WheelEvent) => {
    if (!(event.metaKey || event.ctrlKey) || !this.ready) {
      return;
    }

    event.preventDefault();
    const origin: readonly [number, number] = [
      event.clientX,
      event.clientY,
    ];

    if (event.deltaY < 0) {
      this.zoomIn(origin);
    } else if (event.deltaY > 0) {
      this.zoomOut(origin);
    }
  };

  private readonly handleSelectionChange = () => {
    if (this.selectionTimer !== undefined) {
      window.clearTimeout(this.selectionTimer);
    }

    this.selectionTimer = window.setTimeout(() => {
      this.selectionTimer = undefined;
      this.publishSelection();
    }, 0);
  };

  private publishSelection(): void {
    const documentIdentity = this.documentIdentity;
    const selection = document.getSelection();

    if (
      !this.ready ||
      !documentIdentity ||
      !selection ||
      selection.rangeCount === 0
    ) {
      return;
    }

    if (selection.isCollapsed) {
      const anchorNode = selection.anchorNode;
      const anchorInsideViewer = Boolean(
        anchorNode &&
          (anchorNode === this.options.viewer ||
            this.options.viewer.contains(anchorNode)),
      );

      if (
        shouldClearCollapsedPdfSelection(
          selection.isCollapsed,
          anchorInsideViewer,
        )
      ) {
        this.options.events.onSelectionChange(undefined);
      }
      return;
    }

    const range = selection.getRangeAt(0);
    const startPage = getPageElement(
      range.startContainer,
      this.options.viewer,
    );
    const endPage = getPageElement(
      range.endContainer,
      this.options.viewer,
    );

    if (!startPage || !endPage) {
      return;
    }

    const startPageNumber = Number(startPage.dataset.pageNumber);
    const endPageNumber = Number(endPage.dataset.pageNumber);

    if (
      !isPositiveInteger(startPageNumber) ||
      !isPositiveInteger(endPageNumber) ||
      startPageNumber > endPageNumber ||
      (this.state.readingMode === 'paged' &&
        startPageNumber !== endPageNumber)
    ) {
      this.options.events.onSelectionChange(undefined);
      return;
    }

    const segments: PdfSelectionSegment[] = [];

    for (
      let pageNumber = startPageNumber;
      pageNumber <= endPageNumber;
      pageNumber += 1
    ) {
      const pageElement = this.options.viewer.querySelector<HTMLElement>(
        `.page[data-page-number="${pageNumber}"]`,
      );
      const index = pageElement
        ? buildPageTextIndex(pageElement)
        : undefined;

      if (!index) {
        this.publishPageFallbackSelection(pageNumber, selection.toString());
        return;
      }

      const startOffset =
        pageNumber === startPageNumber
          ? index.resolveBoundary(
              range.startContainer,
              range.startOffset,
            )
          : 0;
      const endOffset =
        pageNumber === endPageNumber
          ? index.resolveBoundary(range.endContainer, range.endOffset)
          : index.text.length;

      if (
        startOffset === undefined ||
        endOffset === undefined ||
        startOffset > endOffset
      ) {
        this.publishPageFallbackSelection(pageNumber, selection.toString());
        return;
      }

      segments.push({
        pageNumber,
        pageText: index.text,
        startOffset,
        endOffset,
      });
    }

    const snapshot = createPdfSelectionSnapshotFromSegments(
      documentIdentity,
      segments,
      selection.toString(),
      this.state.readingMode,
    );

    if (!snapshot) {
      this.publishPageFallbackSelection(
        startPageNumber,
        selection.toString(),
      );
      return;
    }

    this.options.events.onSelectionChange(snapshot);
  }

  private reportSelectionMappingFailure(pageNumber: number): void {
    console.warn(
      `[pdf-workbench] 第 ${pageNumber} 页 Text Layer 选区映射失败；保留浏览器复制，但不生成 Anchor。`,
    );
    this.options.events.onSelectionChange(undefined);
  }

  private publishPageFallbackSelection(
    pageNumber: number,
    selectedText: string,
  ): void {
    const text = normalizePdfSelectionText(selectedText);

    if (!text) {
      this.reportSelectionMappingFailure(pageNumber);
      return;
    }

    console.info(
      `[pdf-workbench] 第 ${pageNumber} 页使用页级 Anchor 保留选区。`,
    );
    this.options.events.onSelectionChange({
      text,
      target: createPdfPageTarget(pageNumber),
    });
  }

  private applyInitialState(): void {
    this.pdfViewer.scrollMode =
      this.state.readingMode === 'paged'
        ? ScrollMode.PAGE
        : ScrollMode.VERTICAL;
    this.pdfViewer.pagesRotation = this.state.rotation;
    this.pdfViewer.currentScaleValue = pdfJsScaleValue(
      this.state.scaleMode,
      this.state.customScale,
    );
    this.goToPage(this.state.pageNumber);

    if (this.state.pageOffsetRatio > 0) {
      window.requestAnimationFrame(() => {
        const page = this.options.viewer.querySelector<HTMLElement>(
          `.page[data-page-number="${this.state.pageNumber}"]`,
        );

        if (page) {
          this.options.container.scrollTop =
            page.offsetTop +
            page.offsetHeight * this.state.pageOffsetRatio;
        }
      });
    }
  }

  private emitViewState(): void {
    if (!this.ready) {
      return;
    }

    this.options.events.onViewStateChange(
      clonePdfWorkbenchState(this.state),
    );
  }
}
