import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { useWorkbenchContributions } from '../../renderer/workbench/runtime/use-workbench-contributions';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
import { useWorkbenchConversationContribution } from '../../renderer/conversation/workbench-conversation-context';
import {
  DocumentAiWorkbenchShell,
} from '../document-ai/renderer/DocumentAiWorkbenchShell';
import { userMessageFromError } from '../../shared/ipc-error';
import {
  findTextSelectionInput,
  interactionFromTextSelection,
} from '../../shared/workbench/selection';
import type {
  WorkbenchInteractionSnapshot,
} from '../../shared/workbench/interaction';
import type { AssetTarget } from '../../shared/workbench/anchor';
import {
  registerWorkbenchAnchorController,
  WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT,
} from '../../renderer/workbench/host/workbench-anchor-bridge';
import type {
  PdfDocumentSummary,
  PdfFindStatus,
  PdfOutlineItem,
  PdfPasswordRequest,
  PdfViewerAdapter,
  PdfViewerError,
} from './pdf-viewer-adapter';
import {
  clonePdfWorkbenchState,
  createPdfPageTarget,
  createPdfSaveViewStateCommand,
  DEFAULT_PDF_WORKBENCH_STATE,
  PDF_REGION_ANCHOR_TYPE,
  PDF_REGION_ANCHOR_VERSION,
  isPdfSaveViewStateResult,
  isPdfWorkbenchPayload,
  pdfWorkbenchManifest,
  type PdfReadingMode,
  type PdfScaleMode,
  type PdfSidebar,
  type PdfWorkbenchViewState,
} from './shared';
import { createPdfRendererActions } from './renderer-actions';
import {
  calculatePdfPanScroll,
  canStartPdfPan,
  hasPdfHorizontalOverflow,
  type PdfPanOrigin,
} from './pdf-pan';
import {
  completePdfRegionPointer,
  movePdfRegionPointer,
  shouldDismissPdfRegionSelection,
} from './pdf-region-interaction';
import {
  createDocumentConversationContext,
  createDocumentConversationContribution,
  type DocumentConversationContext,
} from '../document-ai/renderer/conversation/document-conversation-contribution';

type PdfLoadState =
  | {
      readonly kind: 'loading';
      readonly percent?: number;
    }
  | {
      readonly kind: 'password';
      readonly request: PdfPasswordRequest;
    }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly message: string };

const SCALE_PRESETS = [50, 75, 100, 125, 150, 200, 300, 400];

interface ActivePdfPan extends PdfPanOrigin {
  readonly pointerId: number;
}

interface PdfRegionSelection {
  readonly pointerId: number;
  readonly pageNumber: number;
  readonly page: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly startX: number;
  readonly startY: number;
  readonly currentX: number;
  readonly currentY: number;
  readonly explicit: boolean;
}

interface PdfRegionActionMenu {
  readonly top: number;
}

interface CompletedPdfRegionSelection {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface PdfRegionPreviewInput {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Captures a compact, local-only visual reference for a formula/image region.
 * It is intentionally small because Project conversation context crosses IPC
 * and is persisted in the application database.
 */
export function capturePdfRegionPreview(
  source: HTMLCanvasElement,
  region: PdfRegionPreviewInput,
): string | undefined {
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  if (sourceWidth < 1 || sourceHeight < 1) return undefined;

  const sx = Math.max(0, Math.floor(region.x * sourceWidth));
  const sy = Math.max(0, Math.floor(region.y * sourceHeight));
  const sw = Math.min(
    sourceWidth - sx,
    Math.max(1, Math.ceil(region.width * sourceWidth)),
  );
  const sh = Math.min(
    sourceHeight - sy,
    Math.max(1, Math.ceil(region.height * sourceHeight)),
  );
  // Keep text and formulas legible in Office/PPT previews while staying below
  // the persisted conversation-context limit. The old fixed 180px preview was
  // often too small for slide text, so encode the largest bounded JPEG.
  const maximumDataUrlLength = 56 * 1_024;
  let maximumEdge = Math.min(960, Math.max(sw, sh));
  const preview = document.createElement('canvas');
  const context = preview.getContext('2d');
  if (!context) return undefined;

  try {
    while (maximumEdge >= 240) {
      const scale = Math.min(1, maximumEdge / Math.max(sw, sh));
      preview.width = Math.max(1, Math.round(sw * scale));
      preview.height = Math.max(1, Math.round(sh * scale));
      context.drawImage(
        source,
        sx,
        sy,
        sw,
        sh,
        0,
        0,
        preview.width,
        preview.height,
      );
      for (const quality of [0.86, 0.74, 0.62]) {
        const encoded = preview.toDataURL('image/jpeg', quality);
        if (encoded.length <= maximumDataUrlLength) return encoded;
      }
      maximumEdge = Math.floor(maximumEdge * 0.75);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function findRenderedPdfCanvas(
  page: HTMLElement,
): HTMLCanvasElement | undefined {
  return [...page.querySelectorAll<HTMLCanvasElement>('canvas')]
    .filter((canvas) => canvas.width > 0 && canvas.height > 0)
    .sort((left, right) =>
      right.width * right.height - left.width * left.height,
    )[0];
}

const PDF_REGION_QUICK_QUESTIONS = [
  ['解释', '请用通俗易懂的语言解释我框选的内容。'],
  ['举例', '请针对我框选的内容给出一个具体、容易理解的例子。'],
  ['翻译', '请翻译我框选的内容；如果主要是中文则翻译成英文，否则翻译成中文。'],
  ['总结', '请简洁总结我框选内容的核心信息。'],
] as const;

function isPdfPanBlockedTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      '.textLayer span, .textLayer br, .annotationLayer a, button, input, textarea, select, [contenteditable="true"], [role="button"]',
    ) !== null
  );
}

function SearchIcon() {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8.5" cy="8.5" r="4.75" />
      <path d="m12.2 12.2 3.4 3.4" />
    </svg>
  );
}

function ChevronIcon({ direction }: { readonly direction: 'left' | 'right' }) {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === 'left' ? (
        <path d="m12.5 5-5 5 5 5" />
      ) : (
        <path d="m7.5 5 5 5-5 5" />
      )}
    </svg>
  );
}

function FitWidthIcon() {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 6v8M16.5 6v8M6.5 10h7" />
      <path d="m8.5 8-2 2 2 2M11.5 8l2 2-2 2" />
    </svg>
  );
}

function reportRendererError(
  error: unknown,
  fallback: string,
  onError: (message: string) => void,
): void {
  const message = userMessageFromError(error, fallback);

  if (message) {
    console.error(message, error);
    onError(message);
  }
}

function identityInteraction(
  interaction: WorkbenchInteractionSnapshot,
): WorkbenchInteractionSnapshot {
  return interaction;
}

function OutlineTree({
  items,
  onActivate,
}: {
  readonly items: readonly PdfOutlineItem[];
  readonly onActivate: (item: PdfOutlineItem) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onActivate(item)}
            className="ui-button w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] leading-4 text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
            style={{
              fontWeight: item.bold ? 600 : undefined,
              fontStyle: item.italic ? 'italic' : undefined,
            }}
            title={item.title}
          >
            {item.title}
          </button>
          {item.items.length > 0 && (
            <div className="ml-2.5 border-l border-white/[0.07] pl-1.5">
              <OutlineTree
                items={item.items}
                onActivate={onActivate}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function PdfThumbnail({
  adapter,
  pageNumber,
  rotation,
  current,
  onSelect,
}: {
  readonly adapter: PdfViewerAdapter;
  readonly pageNumber: number;
  readonly rotation: number;
  readonly current: boolean;
  readonly onSelect: () => void;
}) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;

    if (!root || !canvas) {
      return;
    }

    let active = true;
    const render = () => {
      if (!active) {
        return;
      }

      void adapter
        .renderThumbnail(pageNumber, canvas)
        .catch((error) => {
          if (active) {
            console.warn(
              `[pdf-workbench] 第 ${pageNumber} 页缩略图渲染失败`,
              error,
            );
          }
        });
    };

    if (typeof IntersectionObserver === 'undefined') {
      render();
      return () => {
        active = false;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          render();
        }
      },
      { root: root.closest('[data-pdf-sidebar-scroll]'), rootMargin: '160px' },
    );
    observer.observe(root);

    return () => {
      active = false;
      observer.disconnect();
    };
  }, [adapter, pageNumber, rotation]);

  return (
    <button
      ref={rootRef}
      type="button"
      aria-label={`跳转到第 ${pageNumber} 页`}
      aria-current={current ? 'page' : undefined}
      onClick={onSelect}
      className={`ui-button mx-auto block w-[154px] rounded-xl border p-2 transition ${
        current
          ? 'border-indigo-400/50 bg-indigo-400/[0.08]'
          : 'border-transparent hover:border-white/[0.1] hover:bg-white/[0.04]'
      }`}
    >
      <span className="flex min-h-20 items-center justify-center rounded bg-white/95 shadow-[0_4px_14px_rgba(0,0,0,0.22)]">
        <canvas ref={canvasRef} className="block max-w-full" />
      </span>
      <span
        className={`mt-1.5 block text-[10px] ${
          current ? 'text-indigo-300' : 'text-slate-500'
        }`}
      >
        {pageNumber}
      </span>
    </button>
  );
}

function PasswordPrompt({
  request,
}: {
  readonly request: PdfPasswordRequest;
}) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-[#151a20]/95 p-6">
      <form
        className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-[#232931] p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();

          if (!password || submitting) {
            return;
          }

          const submittedPassword = password;
          setSubmitting(true);
          setPassword('');
          request.submit(submittedPassword);
        }}
      >
        <h3 className="text-sm font-semibold text-slate-100">
          这份 PDF 受密码保护
        </h3>
        <p className="mt-1.5 text-xs leading-5 text-slate-500">
          {request.incorrect
            ? '密码不正确，请重新输入。'
            : '密码仅用于当前阅读会话，不会保存到应用中。'}
        </p>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          value={password}
          onChange={(event) => {
            setSubmitting(false);
            setPassword(event.target.value);
          }}
          className="mt-4 h-9 w-full rounded-lg border border-white/[0.1] bg-[#151a20] px-3 text-sm text-slate-100 outline-none focus:border-indigo-400/60"
          aria-label="PDF 密码"
        />
        <button
          type="submit"
          disabled={!password || submitting}
          className="ui-button mt-3 h-9 w-full rounded-lg bg-indigo-500/90 text-xs font-medium text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? '正在验证…' : '打开 PDF'}
        </button>
      </form>
    </div>
  );
}

interface PdfDocumentWorkbenchViewProps
  extends RendererWorkbenchViewProps {
  readonly contributionOwnerId: string;
  readonly createSaveViewStateCommand?: typeof createPdfSaveViewStateCommand;
  readonly isSaveViewStateResult?: typeof isPdfSaveViewStateResult;
  readonly mapInteraction?: (
    interaction: WorkbenchInteractionSnapshot,
  ) => WorkbenchInteractionSnapshot;
  readonly mapAnchorTarget?: (target: AssetTarget) => AssetTarget;
}

export function PdfDocumentWorkbenchView({
  asset,
  bootstrap,
  executeCommand,
  onRelink,
  onRefresh,
  onReveal,
  onInteractionChange,
  onOpenExternal,
  onError,
  contributionOwnerId,
  createSaveViewStateCommand =
    createPdfSaveViewStateCommand,
  isSaveViewStateResult = isPdfSaveViewStateResult,
  mapInteraction = identityInteraction,
  mapAnchorTarget = (target) => target,
}: PdfDocumentWorkbenchViewProps) {
  const runtime = useWorkbenchRuntime();
  const payload = isPdfWorkbenchPayload(bootstrap.payload)
    ? bootstrap.payload
    : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<PdfViewerAdapter | undefined>(undefined);
  const readyRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const latestViewStateRef = useRef<PdfWorkbenchViewState>(
    payload?.viewState ??
      clonePdfWorkbenchState(DEFAULT_PDF_WORKBENCH_STATE),
  );
  const viewStateVersionRef = useRef(0);
  const savedViewStateVersionRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activePanRef = useRef<ActivePdfPan | undefined>(undefined);
  const activeRegionRef = useRef<PdfRegionSelection | undefined>(undefined);
  const dismissedRegionPointerRef = useRef<number | undefined>(undefined);
  const regionMenuRef = useRef<HTMLDivElement>(null);
  const [loadState, setLoadState] = useState<PdfLoadState>({
    kind: 'loading',
  });

  useEffect(() => {
    if (loadState.kind !== 'ready') return;
    const findPage = (target: AssetTarget): HTMLElement | undefined => {
      const mapped = mapAnchorTarget(target);
      if (mapped.scope !== 'content') return undefined;
      const payload = mapped.anchorPayload as Record<string, unknown>;
      const start = payload.start as Record<string, unknown> | undefined;
      const pageNumber = typeof payload.pageNumber === 'number'
        ? payload.pageNumber
        : typeof start?.pageNumber === 'number' ? start.pageNumber : undefined;
      if (!pageNumber) return undefined;
      return viewerRef.current?.querySelector<HTMLElement>(
        `.page[data-page-number="${pageNumber}"]`,
      ) ?? undefined;
    };
    const resolve = (target: AssetTarget) => {
      const mapped = mapAnchorTarget(target);
      const page = findPage(mapped);
      if (!page || mapped.scope !== 'content') return;
      const payload = mapped.anchorPayload as Record<string, unknown>;
      const pageRect = page.getBoundingClientRect();
      const x = typeof payload.x === 'number' ? payload.x : 1;
      const y = typeof payload.y === 'number' ? payload.y : 0;
      const width = typeof payload.width === 'number' ? payload.width : 0;
      const height = typeof payload.height === 'number' ? payload.height : 0;
      return {
        left: pageRect.left + x * pageRect.width,
        top: pageRect.top + y * pageRect.height,
        width: width * pageRect.width,
        height: height * pageRect.height,
      };
    };
    const reveal = (target: AssetTarget) => {
      const page = findPage(target);
      if (!page) return false;
      page.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    };
    const notifyLayout = () => window.dispatchEvent(
      new Event(WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT),
    );
    const container = containerRef.current;
    const dispose = registerWorkbenchAnchorController(
      `${pdfWorkbenchManifest.id}:${bootstrap.sessionId}.anchors`,
      asset.id,
      { resolve, reveal },
    );
    container?.addEventListener('scroll', notifyLayout, { passive: true });
    return () => {
      dispose();
      container?.removeEventListener('scroll', notifyLayout);
    };
  }, [asset.id, bootstrap.sessionId, loadState.kind, mapAnchorTarget]);
  const [summary, setSummary] = useState<PdfDocumentSummary>();
  const [outline, setOutline] = useState<readonly PdfOutlineItem[]>([]);
  const [viewState, setViewState] = useState<PdfWorkbenchViewState>(
    payload?.viewState ??
      clonePdfWorkbenchState(DEFAULT_PDF_WORKBENCH_STATE),
  );
  const [pageInput, setPageInput] = useState(
    String(payload?.viewState.pageNumber ?? 1),
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [findStatus, setFindStatus] = useState<PdfFindStatus>({
    state: 'idle',
    current: 0,
    total: 0,
  });
  const [scaleMenuOpen, setScaleMenuOpen] = useState(false);
  const [panAvailable, setPanAvailable] = useState(false);
  const [panning, setPanning] = useState(false);
  const [regionMode, setRegionMode] = useState(true);
  const [regionSelection, setRegionSelection] =
    useState<PdfRegionSelection>();
  const [completedRegionSelection, setCompletedRegionSelection] =
    useState<CompletedPdfRegionSelection>();
  const [completedRegionContext, setCompletedRegionContext] =
    useState<DocumentConversationContext>();
  const [regionActionMenu, setRegionActionMenu] =
    useState<PdfRegionActionMenu>();
  const conversationOwnerId =
    `${contributionOwnerId}:${bootstrap.sessionId}.conversation`;
  const conversationContribution = useMemo(
    () => createDocumentConversationContribution({
      projectId: asset.projectId,
      assetId: asset.id,
      allowAnswerAttachments: true,
      answerActionPresentation: {
        label: '附着原文',
        selectionLabel: '附着原文',
        successMessage: '已将回复附着到原文',
        failureMessage: '附着原文失败',
      },
      onContextReleased() {
        setRegionActionMenu(undefined);
      },
    }),
    [
      asset.id,
      asset.projectId,
      contributionOwnerId,
    ],
  );
  const conversationRuntime = useWorkbenchConversationContribution(
    conversationOwnerId,
    asset.id,
    conversationContribution,
    loadState.kind === 'ready',
  );

  useEffect(() => {
    // Document questions use one predictable interaction: a rectangular
    // region. PDF.js' transparent text layer must not leave a second,
    // browser-native blue selection behind it.
    window.getSelection()?.removeAllRanges();
  }, [regionMode]);

  useEffect(() => {
    if (!regionActionMenu || !completedRegionSelection) return;
    const dismiss = (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container || !(event.target instanceof Node) ||
        !container.contains(event.target)) return;
      const containerRect = container.getBoundingClientRect();
      if (!shouldDismissPdfRegionSelection({
        menu: regionMenuRef.current,
        target: event.target,
        selection: completedRegionSelection,
        point: {
          x: event.clientX - containerRect.left + container.scrollLeft,
          y: event.clientY - containerRect.top + container.scrollTop,
        },
      })) return;
      dismissedRegionPointerRef.current = event.pointerId;
      setCompletedRegionSelection(undefined);
      setCompletedRegionContext(undefined);
      setRegionActionMenu(undefined);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [completedRegionSelection, regionActionMenu]);

  const persistViewState = useCallback(
    async (state: PdfWorkbenchViewState, version: number) => {
      try {
        const result = await executeCommand(
          createSaveViewStateCommand(state),
        );

        if (!isSaveViewStateResult(result.payload)) {
          throw new Error('PDF Workbench 视图状态响应无效');
        }
        savedViewStateVersionRef.current = Math.max(
          savedViewStateVersionRef.current,
          version,
        );
      } catch (error) {
        reportRendererError(
          error,
          '无法保存 PDF 阅读位置。',
          onError,
        );
      }
    },
    [
      createSaveViewStateCommand,
      executeCommand,
      isSaveViewStateResult,
      onError,
    ],
  );

  const scheduleViewStateSave = useCallback(
    (state: PdfWorkbenchViewState) => {
      latestViewStateRef.current = state;
      viewStateVersionRef.current += 1;

      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = undefined;
        void persistViewState(
          latestViewStateRef.current,
          viewStateVersionRef.current,
        );
      }, 500);
    },
    [persistViewState],
  );

  useEffect(() => {
    if (!payload) {
      return;
    }

    const container = containerRef.current;
    const viewer = viewerRef.current;

    if (!container || !viewer) {
      return;
    }

    let active = true;
    let adapter: PdfViewerAdapter | undefined;
    readyRef.current = false;
    setLoadState({ kind: 'loading' });

    void import('./pdf-viewer-adapter')
      .then(async ({
        PdfViewerAdapter: Adapter,
        resolvePdfAssetUrls,
      }) => {
        if (!active) {
          return;
        }

        adapter = new Adapter({
          container,
          viewer,
          contentUrl: payload.contentUrl,
          initialState: payload.viewState,
          assetUrls: resolvePdfAssetUrls(document.baseURI),
          onOpenExternal,
          events: {
            onReady(documentSummary) {
              if (!active) {
                return;
              }

              readyRef.current = true;
              setSummary(documentSummary);
              setOutline(adapter?.getOutline() ?? []);
              setLoadState({ kind: 'ready' });
            },
            onProgress(percent) {
              if (active && !readyRef.current) {
                setLoadState({ kind: 'loading', percent });
              }
            },
            onViewStateChange(nextViewState) {
              if (!active) {
                return;
              }

              setViewState(nextViewState);
              setPageInput(String(nextViewState.pageNumber));
              scheduleViewStateSave(nextViewState);
            },
            onSelectionChange(selection) {
              if (active) {
                onInteractionChange(
                  mapInteraction(
                    interactionFromTextSelection(selection),
                  ),
                );
              }
            },
            onFindStatusChange(status) {
              if (active) {
                setFindStatus(status);
              }
            },
            onPasswordRequest(request) {
              if (active) {
                setLoadState({ kind: 'password', request });
              }
            },
            onError(error: PdfViewerError) {
              if (!active) {
                return;
              }

              if (!readyRef.current) {
                setLoadState({
                  kind: 'failed',
                  message: error.message,
                });
              } else {
                onError(error.message);
              }
            },
          },
        });
        adapterRef.current = adapter;
        await adapter.start();
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        const message = userMessageFromError(
          error,
          'PDF 阅读组件初始化失败。',
        );
        setLoadState({
          kind: 'failed',
          message: message ?? 'PDF 阅读组件初始化失败。',
        });
      });

    return () => {
      active = false;
      readyRef.current = false;
      onInteractionChange(mapInteraction({ inputs: [] }));

      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      if (
        savedViewStateVersionRef.current <
        viewStateVersionRef.current
      ) {
        void persistViewState(
          latestViewStateRef.current,
          viewStateVersionRef.current,
        );
      }
      if (adapterRef.current === adapter) {
        adapterRef.current = undefined;
      }
      void adapter?.destroy();
    };
  }, [
    onError,
    onOpenExternal,
    onInteractionChange,
    mapInteraction,
    payload,
    persistViewState,
    scheduleViewStateSave,
  ]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [searchOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const root = rootRef.current;
      const editing =
        target?.matches('input, textarea, select') ||
        target?.isContentEditable;

      if (
        target &&
        target !== document.body &&
        root &&
        !root.contains(target)
      ) {
        return;
      }
      if (modifier && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        if (activeRegionRef.current || regionMode) {
          const activeRegion = activeRegionRef.current;
          if (
            activeRegion &&
            containerRef.current?.hasPointerCapture(activeRegion.pointerId)
          ) {
            containerRef.current.releasePointerCapture(
              activeRegion.pointerId,
            );
          }
          activeRegionRef.current = undefined;
          setRegionSelection(undefined);
          setCompletedRegionSelection(undefined);
          setCompletedRegionContext(undefined);
          setRegionActionMenu(undefined);
          setRegionMode(false);
          return;
        }
        if (scaleMenuOpen) {
          setScaleMenuOpen(false);
        } else if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery('');
          adapterRef.current?.closeFind();
        }
        return;
      }
      if (editing || !readyRef.current) {
        return;
      }
      if (modifier && event.key === '0') {
        event.preventDefault();
        adapterRef.current?.setScaleMode('page-width');
      } else if (modifier && event.key === '1') {
        event.preventDefault();
        adapterRef.current?.setScaleMode('actual-size');
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        adapterRef.current?.zoomIn();
      } else if (event.key === '-') {
        event.preventDefault();
        adapterRef.current?.zoomOut();
      } else if (event.key === 'PageUp') {
        event.preventDefault();
        adapterRef.current?.previousPage();
      } else if (event.key === 'PageDown') {
        event.preventDefault();
        adapterRef.current?.nextPage();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [asset.id, regionMode, scaleMenuOpen, searchOpen]);

  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;

    if (!container || !viewer) {
      return;
    }

    let layoutFrame: number | undefined;
    const updateLayout = () => {
      if (layoutFrame !== undefined) {
        window.cancelAnimationFrame(layoutFrame);
      }
      layoutFrame = window.requestAnimationFrame(() => {
        layoutFrame = undefined;
        adapterRef.current?.refreshLayout();
        setPanAvailable(
          hasPdfHorizontalOverflow(
            container.scrollWidth,
            container.clientWidth,
          ),
        );
      });
    };
    const updateAvailability = () => {
      setPanAvailable(
        hasPdfHorizontalOverflow(
          container.scrollWidth,
          container.clientWidth,
        ),
      );
    };
    const frame = window.requestAnimationFrame(updateAvailability);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(updateLayout);
    observer?.observe(container);

    return () => {
      window.cancelAnimationFrame(frame);
      if (layoutFrame !== undefined) {
        window.cancelAnimationFrame(layoutFrame);
      }
      observer?.disconnect();
    };
  }, [
    loadState.kind,
    viewState.customScale,
    viewState.readingMode,
    viewState.rotation,
    viewState.scaleMode,
    viewState.sidebar,
  ]);

  const stopPanning = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (activePanRef.current?.pointerId !== event.pointerId) {
        return;
      }

      activePanRef.current = undefined;
      setPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  const startPanning = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dismissedRegionPointerRef.current === event.pointerId) {
        dismissedRegionPointerRef.current = undefined;
        event.preventDefault();
        return;
      }
      const target = event.target;
      const page =
        target instanceof Element
          ? target.closest<HTMLElement>('.page[data-page-number]')
          : null;
      const startsOnInteractiveElement =
        target instanceof Element &&
        target.closest(
          '.annotationLayer a, button, input, textarea, select, [role="button"]',
        ) !== null;
      const shouldSelectRegion =
        regionMode && Boolean(page) && !startsOnInteractiveElement;

      if (shouldSelectRegion) {
        const canvas = page ? findRenderedPdfCanvas(page) : undefined;
        const pageNumber = Number(page?.dataset.pageNumber);
        if (
          event.button === 0 &&
          event.isPrimary &&
          page &&
          canvas &&
          Number.isSafeInteger(pageNumber) &&
          pageNumber > 0
        ) {
          const selection: PdfRegionSelection = {
            pointerId: event.pointerId,
            pageNumber,
            page,
            canvas,
            startX: event.clientX,
            startY: event.clientY,
            currentX: event.clientX,
            currentY: event.clientY,
            explicit: regionMode,
          };
          activeRegionRef.current = selection;
          setRegionSelection(selection);
          setCompletedRegionSelection(undefined);
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }
        return;
      }
      const container = event.currentTarget;

      if (
        !canStartPdfPan({
          button: event.button,
          isPrimary: event.isPrimary,
          scrollWidth: container.scrollWidth,
          clientWidth: container.clientWidth,
          blockedTarget: isPdfPanBlockedTarget(event.target),
        })
      ) {
        return;
      }

      activePanRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      };
      container.setPointerCapture(event.pointerId);
      setPanning(true);
      event.preventDefault();
    },
    [panAvailable, regionMode],
  );

  const movePanning = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const region = activeRegionRef.current;
      if (region?.pointerId === event.pointerId) {
        const next = movePdfRegionPointer(
          region, event.pointerId, event.clientX, event.clientY,
        )!;
        activeRegionRef.current = next;
        setRegionSelection(next);
        event.preventDefault();
        return;
      }
      const origin = activePanRef.current;

      if (!origin || origin.pointerId !== event.pointerId) {
        return;
      }

      const next = calculatePdfPanScroll(
        origin,
        event.clientX,
        event.clientY,
      );
      event.currentTarget.scrollLeft = next.left;
      event.currentTarget.scrollTop = next.top;
      event.preventDefault();
    },
    [],
  );

  const finishPointerInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const region = activeRegionRef.current;
      if (region?.pointerId === event.pointerId) {
        activeRegionRef.current = undefined;
        setRegionSelection(undefined);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }

        const pageRect = region.page.getBoundingClientRect();
        const completed = completePdfRegionPointer(
          region, event.pointerId, event.clientX, event.clientY, pageRect,
        )!;
        if (completed.kind === 'too-small') {
          if (region.explicit) {
            onError('框选区域太小，请重新拖动选择公式或图像。');
          }
          return;
        }

        const previewDataUrl = capturePdfRegionPreview(
          region.canvas,
          completed,
        );
        const rawTarget: AssetTarget = {
          scope: 'content',
          anchorType: PDF_REGION_ANCHOR_TYPE,
          anchorVersion: PDF_REGION_ANCHOR_VERSION,
          anchorPayload: {
            pageNumber: region.pageNumber,
            x: completed.x,
            y: completed.y,
            width: completed.width,
            height: completed.height,
          },
        };
        const target = mapInteraction({ focus: rawTarget, inputs: [] }).focus ?? rawTarget;
        setCompletedRegionContext(createDocumentConversationContext({
          target,
          pageNumber: region.pageNumber,
          ...(previewDataUrl ? { previewDataUrl } : {}),
        }));
        const containerRect = event.currentTarget.getBoundingClientRect();
        setCompletedRegionSelection({
          left:
            pageRect.left + completed.x * pageRect.width - containerRect.left +
            event.currentTarget.scrollLeft,
          top:
            pageRect.top + completed.y * pageRect.height - containerRect.top +
            event.currentTarget.scrollTop,
          width: completed.width * pageRect.width,
          height: completed.height * pageRect.height,
        });
        setRegionActionMenu({
          top: Math.max(12, completed.top - containerRect.top - 46),
        });
        event.preventDefault();
        return;
      }
      stopPanning(event);
    },
    [mapInteraction, onError, stopPanning],
  );

  const cancelPointerInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (activeRegionRef.current?.pointerId === event.pointerId) {
        activeRegionRef.current = undefined;
        setRegionSelection(undefined);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        return;
      }
      stopPanning(event);
    },
    [stopPanning],
  );

  useEffect(() => {
    if (loadState.kind !== 'ready') {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      adapterRef.current?.refreshLayout();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [loadState.kind, viewState.sidebar]);

  const ready = loadState.kind === 'ready';
  const pageCount = summary?.pageCount ?? 0;
  const scalePercent = Math.round(viewState.customScale * 100);
  const outlineAvailable = summary?.hasOutline ?? false;

  const goToPageInput = () => {
    const requested = Number(pageInput);

    if (Number.isFinite(requested) && pageCount > 0) {
      adapterRef.current?.goToPage(requested);
    } else {
      setPageInput(String(viewState.pageNumber));
    }
  };
  const setReadingMode = (mode: PdfReadingMode) => {
    adapterRef.current?.setReadingMode(mode);
  };
  const setSidebar = (sidebar: PdfSidebar) => {
    adapterRef.current?.setSidebar(sidebar);
  };
  const setScaleMode = (
    mode: Exclude<PdfScaleMode, 'custom'>,
  ) => {
    adapterRef.current?.setScaleMode(mode);
    setScaleMenuOpen(false);
  };
  const reveal = useCallback(async () => {
    try {
      await onReveal();
    } catch (error) {
      reportRendererError(
        error,
        '无法在文件夹中显示 PDF。',
        onError,
      );
    }
  }, [onError, onReveal]);
  const copySelection = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        reportRendererError(
          error,
          '无法复制 PDF 选中内容。',
          onError,
        );
      }
    },
    [onError],
  );

  const rendererActions = useMemo(
    () =>
      createPdfRendererActions({
        ready,
        searchOpen,
        readingMode: viewState.readingMode,
        sidebar: viewState.sidebar,
        hasOutline: outlineAvailable,
        onToggleSearch: () =>
          setSearchOpen((current) => !current),
        onReadingMode: setReadingMode,
        onSidebar: setSidebar,
        onPageWidth: () => setScaleMode('page-width'),
        onPageFit: () => setScaleMode('page-fit'),
        onActualSize: () => setScaleMode('actual-size'),
        onRotateClockwise: () => adapterRef.current?.rotate(90),
        onRotateCounterclockwise: () =>
          adapterRef.current?.rotate(-90),
        hasSelection: () => {
          const current = runtime.interactionContext();

          return Boolean(
            current && findTextSelectionInput(current)?.text,
          );
        },
        onCopySelection: copySelection,
        onReveal: reveal,
        onAiExplain: (text, anchor) => {
          const pageNumber =
            typeof (anchor.anchorPayload as Record<string, unknown> | undefined)?.pageNumber === 'number'
              ? ((anchor.anchorPayload as Record<string, unknown>).pageNumber as number)
              : undefined;
          conversationRuntime.open({
            ownerId: conversationOwnerId,
            context: createDocumentConversationContext({
              target: anchor,
              ...(pageNumber === undefined ? {} : { pageNumber }),
              selectedText: text,
            }),
          });
        },
        onAiSummarize: (pageNumber, anchor) => {
          conversationRuntime.open({
            ownerId: conversationOwnerId,
            context: createDocumentConversationContext({
              target: anchor,
              pageNumber,
            }),
            question: `请总结第 ${pageNumber} 页的主要内容。`,
            submit: true,
          });
        },
      }),
    [
      contributionOwnerId,
      conversationOwnerId,
      conversationRuntime,
      copySelection,
      outlineAvailable,
      ready,
      reveal,
      runtime,
      searchOpen,
      viewState.readingMode,
      viewState.sidebar,
    ],
  );
  useWorkbenchContributions(
    contributionOwnerId,
    rendererActions,
  );

  const openContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const current = runtime.interactionContext();
      const selection = current
        ? findTextSelectionInput(current)
        : undefined;
      const focus =
        selection?.target ??
        createPdfPageTarget(viewState.pageNumber);

      const interaction = mapInteraction(
        interactionFromTextSelection(selection, focus),
      );

      runtime.openContextMenu(
        bootstrap.sessionId,
        { x: event.clientX, y: event.clientY },
        interaction,
      );
    },
    [
      bootstrap.sessionId,
      mapInteraction,
      runtime,
      viewState.pageNumber,
    ],
  );

  if (!payload) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="text-sm font-medium text-rose-300">
            PDF Workbench 数据无效
          </p>
          <p className="mt-2 text-xs text-slate-500">
            请刷新资料或重新定位文件后再试。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="learning-pdf-workbench relative h-full min-h-0 overflow-hidden bg-[#151a20]"
      aria-label="PDF 阅读工作台"
      onContextMenuCapture={openContextMenu}
    >
      <style>{`
        .learning-pdf-workbench .pdfViewer {
          padding: 22px 20px 96px;
          --page-border: 1px solid rgba(255, 255, 255, 0.06);
          background: #20262e;
        }
        .learning-pdf-workbench .pdfViewer .page {
          margin: 0 auto 18px;
          border-radius: 2px;
          box-shadow: 0 10px 32px rgba(0, 0, 0, 0.34);
        }
        .learning-pdf-workbench .textLayer {
          pointer-events: none;
          user-select: none !important;
          -webkit-user-select: none !important;
        }
        .learning-pdf-workbench .textLayer ::selection {
          background: transparent;
        }
        .learning-pdf-workbench .textLayer .highlight {
          background: rgba(250, 204, 21, 0.32);
          border-radius: 2px;
        }
        .learning-pdf-workbench .textLayer .highlight.selected {
          background: rgba(249, 115, 22, 0.42);
        }
      `}</style>

      <div className="flex h-full min-h-0">
        {ready && viewState.sidebar !== 'closed' && (
          <aside
            aria-label={
              viewState.sidebar === 'outline'
                ? 'PDF 文档目录'
                : 'PDF 页面缩略图'
            }
            className="flex w-[202px] shrink-0 flex-col border-r border-white/[0.07] bg-[#1b2027]"
          >
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
              <span className="text-[11px] font-medium text-slate-400">
                {viewState.sidebar === 'outline'
                  ? '文档目录'
                  : '页面'}
              </span>
              <button
                type="button"
                aria-label="关闭 PDF 侧栏"
                onClick={() => setSidebar('closed')}
                className="ui-icon-button grid size-6 place-items-center rounded-md text-xs text-slate-500 hover:text-slate-200"
              >
                ×
              </button>
            </div>
            <div
              data-pdf-sidebar-scroll
              className="min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-color:rgba(120,135,165,.45)_transparent] [scrollbar-width:thin]"
            >
              {viewState.sidebar === 'outline' ? (
                outline.length > 0 ? (
                  <OutlineTree
                    items={outline}
                    onActivate={(item) => {
                      void adapterRef.current
                        ?.activateOutlineItem(item)
                        .catch((error) =>
                          reportRendererError(
                            error,
                            '无法跳转到目录位置。',
                            onError,
                          ),
                        );
                    }}
                  />
                ) : (
                  <p className="px-3 py-6 text-center text-[11px] text-slate-600">
                    这份 PDF 没有文档目录
                  </p>
                )
              ) : adapterRef.current ? (
                <div className="space-y-1.5">
                  {Array.from(
                    { length: pageCount },
                    (_, index) => index + 1,
                  ).map((pageNumber) => (
                    <PdfThumbnail
                      key={`${pageNumber}-${viewState.rotation}`}
                      adapter={adapterRef.current!}
                      pageNumber={pageNumber}
                      rotation={viewState.rotation}
                      current={pageNumber === viewState.pageNumber}
                      onSelect={() =>
                        adapterRef.current?.goToPage(pageNumber)
                      }
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </aside>
        )}

        <div className="relative min-w-0 flex-1">
          <div
            ref={containerRef}
            className={[
              'absolute inset-0 overflow-auto bg-[#20262e] [scrollbar-color:rgba(120,135,165,.48)_rgba(32,38,46,.8)] [scrollbar-gutter:stable] [scrollbar-width:thin]',
              regionMode
                ? 'cursor-crosshair select-none'
                : panning
                ? 'cursor-grabbing select-none'
                : panAvailable
                  ? 'cursor-grab'
                  : '',
            ].join(' ')}
            aria-label="PDF 页面画布"
            onPointerDown={startPanning}
            onPointerMove={movePanning}
            onPointerUp={finishPointerInteraction}
            onPointerCancel={cancelPointerInteraction}
            onLostPointerCapture={cancelPointerInteraction}
          >
            <div ref={viewerRef} className="pdfViewer" />
            {completedRegionSelection && (
              <div
                aria-label="已框选区域"
                className="pointer-events-none absolute z-40 border-2 border-indigo-300 bg-indigo-400/20 shadow-[0_0_0_1px_rgba(15,23,42,.7)]"
                style={completedRegionSelection}
              />
            )}
          </div>

          {regionSelection && containerRef.current && (
            <div
              className="pointer-events-none absolute z-40 border-2 border-indigo-400 bg-indigo-400/15"
              style={{
                left:
                  Math.min(regionSelection.startX, regionSelection.currentX) -
                  containerRef.current.getBoundingClientRect().left,
                top:
                  Math.min(regionSelection.startY, regionSelection.currentY) -
                  containerRef.current.getBoundingClientRect().top,
                width: Math.abs(regionSelection.currentX - regionSelection.startX),
                height: Math.abs(regionSelection.currentY - regionSelection.startY),
              }}
            />
          )}

          {regionActionMenu && (
            <div
              ref={regionMenuRef}
              className="absolute right-3 z-50 flex max-w-[calc(100%-1.5rem)] items-center gap-1 overflow-x-auto whitespace-nowrap rounded-xl border border-white/15 bg-[#171c25]/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.45)] backdrop-blur [scrollbar-width:none]"
              style={{ top: regionActionMenu.top }}
            >
              {PDF_REGION_QUICK_QUESTIONS.map(([label, question]) => (
                <button
                  key={label}
                  type="button"
                  disabled={!completedRegionContext}
                  onClick={() => {
                    if (!completedRegionContext) return;
                    conversationRuntime.open({
                      ownerId: conversationOwnerId,
                      context: completedRegionContext,
                      question,
                      submit: true,
                    });
                    setRegionActionMenu(undefined);
                  }}
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition-colors hover:bg-indigo-400/20 hover:text-white disabled:opacity-40"
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                disabled={!completedRegionContext}
                onClick={() => {
                  if (!completedRegionContext) return;
                  conversationRuntime.open({
                    ownerId: conversationOwnerId,
                    context: completedRegionContext,
                  });
                  setRegionActionMenu(undefined);
                }}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-indigo-200 transition-colors hover:bg-indigo-400/20 hover:text-white disabled:opacity-40"
              >
                自由提问
              </button>
              <button
                type="button"
                onClick={() => setRegionActionMenu(undefined)}
                className="shrink-0 rounded-lg px-2 py-1.5 text-[11px] text-slate-500 hover:bg-white/5 hover:text-slate-200"
                aria-label="关闭快捷提问"
              >
                ×
              </button>
            </div>
          )}

          {searchOpen && ready && (
            <div
              role="search"
              className="absolute top-3 left-1/2 z-30 flex h-9 -translate-x-1/2 items-center gap-1 rounded-xl border border-white/[0.12] bg-[#292f37]/98 px-2 shadow-xl backdrop-blur"
            >
              <SearchIcon />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => {
                  const query = event.target.value;
                  setSearchQuery(query);
                  adapterRef.current?.find(query);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    adapterRef.current?.findAgain(event.shiftKey);
                  }
                }}
                placeholder="搜索文档"
                className="h-7 w-48 bg-transparent px-1 text-xs text-slate-100 outline-none placeholder:text-slate-600"
                aria-label="搜索 PDF 内容"
              />
              <span className="min-w-12 text-center text-[10px] text-slate-500">
                {searchQuery
                  ? `${findStatus.current} / ${findStatus.total}`
                  : ''}
              </span>
              <button
                type="button"
                aria-label="上一个搜索结果"
                onClick={() => adapterRef.current?.findAgain(true)}
                className="ui-icon-button grid size-6 place-items-center rounded-md text-slate-400"
              >
                <ChevronIcon direction="left" />
              </button>
              <button
                type="button"
                aria-label="下一个搜索结果"
                onClick={() => adapterRef.current?.findAgain(false)}
                className="ui-icon-button grid size-6 place-items-center rounded-md text-slate-400"
              >
                <ChevronIcon direction="right" />
              </button>
              <button
                type="button"
                aria-label="关闭 PDF 搜索"
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery('');
                  adapterRef.current?.closeFind();
                }}
                className="ui-icon-button grid size-6 place-items-center rounded-md text-sm text-slate-500"
              >
                ×
              </button>
            </div>
          )}

          {loadState.kind === 'loading' && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-[#151a20]">
              <div className="text-center">
                <div className="mx-auto size-7 animate-spin rounded-full border-2 border-white/[0.08] border-t-indigo-400" />
                <p className="mt-3 text-xs text-slate-400">
                  正在载入 PDF
                  {typeof loadState.percent === 'number'
                    ? ` · ${Math.round(loadState.percent)}%`
                    : '…'}
                </p>
              </div>
            </div>
          )}

          {loadState.kind === 'password' && (
            <PasswordPrompt request={loadState.request} />
          )}

          {loadState.kind === 'failed' && (
            <div className="absolute inset-0 z-30 grid place-items-center bg-[#151a20] p-8 text-center">
              <div className="max-w-sm">
                <p className="text-sm font-medium text-rose-300">
                  {loadState.message}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  可以刷新资料、重新定位文件，或者在文件夹中检查原文件。
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={onRefresh}
                    className="ui-button rounded-lg border border-white/[0.1] px-3 py-2 text-xs text-slate-300"
                  >
                    刷新
                  </button>
                  <button
                    type="button"
                    onClick={onRelink}
                    className="ui-button rounded-lg border border-white/[0.1] px-3 py-2 text-xs text-slate-300"
                  >
                    重新定位
                  </button>
                  <button
                    type="button"
                    onClick={() => void reveal()}
                    className="ui-button rounded-lg border border-white/[0.1] px-3 py-2 text-xs text-slate-300"
                  >
                    在文件夹中显示
                  </button>
                </div>
              </div>
            </div>
          )}

          {ready && (
            <div
              aria-label="PDF 阅读工具栏"
              className="absolute bottom-4 left-1/2 z-30 flex h-10 -translate-x-1/2 items-center gap-1 rounded-xl border border-white/[0.12] bg-[#292f37]/95 px-2 shadow-[0_12px_32px_rgba(0,0,0,.38)] backdrop-blur"
            >
              <button
                type="button"
                aria-label="上一页"
                disabled={viewState.pageNumber <= 1}
                onClick={() => adapterRef.current?.previousPage()}
                className="ui-icon-button grid size-7 place-items-center rounded-lg text-slate-300 disabled:opacity-30"
              >
                <ChevronIcon direction="left" />
              </button>
              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <input
                  inputMode="numeric"
                  value={pageInput}
                  onChange={(event) => setPageInput(event.target.value)}
                  onBlur={goToPageInput}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      goToPageInput();
                      event.currentTarget.blur();
                    }
                  }}
                  aria-label="PDF 页码"
                  className="h-6 w-9 rounded-md border border-white/[0.08] bg-[#171c22] text-center text-[11px] text-slate-200 outline-none focus:border-indigo-400/50"
                />
                <span>/ {pageCount}</span>
              </div>
              <button
                type="button"
                aria-label="下一页"
                disabled={
                  pageCount === 0 || viewState.pageNumber >= pageCount
                }
                onClick={() => adapterRef.current?.nextPage()}
                className="ui-icon-button grid size-7 place-items-center rounded-lg text-slate-300 disabled:opacity-30"
              >
                <ChevronIcon direction="right" />
              </button>

              <span className="mx-1 h-5 w-px bg-white/[0.1]" />
              <button
                type="button"
                aria-pressed={regionMode}
                onClick={() => {
                  if (regionMode) {
                    activeRegionRef.current = undefined;
                    setRegionSelection(undefined);
                    setCompletedRegionSelection(undefined);
                    setCompletedRegionContext(undefined);
                    setRegionActionMenu(undefined);
                    setRegionMode(false);
                  } else {
                    setRegionMode(true);
                  }
                }}
                className={`ui-button h-7 shrink-0 whitespace-nowrap rounded-lg px-2 text-[11px] ${
                  regionMode
                    ? 'bg-indigo-400/20 text-indigo-200'
                    : 'text-slate-300'
                }`}
                title={regionMode ? '退出框选模式（也可按 Esc）' : '进入框选模式'}
              >
                {regionMode ? '退出框选' : '框选内容'}
              </button>
              <button
                type="button"
                aria-label="缩小 PDF"
                onClick={() => adapterRef.current?.zoomOut()}
                className="ui-icon-button grid size-7 place-items-center rounded-lg text-base text-slate-300"
              >
                −
              </button>
              <div className="relative">
                <button
                  type="button"
                  aria-label="选择 PDF 缩放比例"
                  aria-expanded={scaleMenuOpen}
                  onClick={() => setScaleMenuOpen((open) => !open)}
                  className="ui-button h-7 min-w-13 rounded-lg px-1.5 text-[11px] text-slate-300"
                >
                  {scalePercent}%
                </button>
                {scaleMenuOpen && (
                  <div className="absolute bottom-9 left-1/2 grid w-24 -translate-x-1/2 gap-0.5 rounded-xl border border-white/[0.12] bg-[#292f37] p-1.5 shadow-xl">
                    {SCALE_PRESETS.map((percent) => (
                      <button
                        key={percent}
                        type="button"
                        onClick={() => {
                          adapterRef.current?.setCustomScale(
                            percent / 100,
                          );
                          setScaleMenuOpen(false);
                        }}
                        className={`ui-menu-item rounded-lg px-2 py-1.5 text-center text-[11px] ${
                          percent === scalePercent
                            ? 'bg-indigo-400/[0.12] text-indigo-200'
                            : 'text-slate-400'
                        }`}
                      >
                        {percent}%
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                aria-label="放大 PDF"
                onClick={() => adapterRef.current?.zoomIn()}
                className="ui-icon-button grid size-7 place-items-center rounded-lg text-base text-slate-300"
              >
                +
              </button>
              <button
                type="button"
                aria-label="PDF 适应宽度"
                onClick={() => setScaleMode('page-width')}
                className={`ui-icon-button grid size-7 place-items-center rounded-lg ${
                  viewState.scaleMode === 'page-width'
                    ? 'bg-indigo-400/[0.12] text-indigo-200'
                    : 'text-slate-300'
                }`}
                title="适应宽度"
              >
                <FitWidthIcon />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PdfWorkbenchView(
  props: RendererWorkbenchViewProps,
) {
  return (
    <DocumentAiWorkbenchShell
      projectId={props.asset.projectId}
      assetId={props.asset.id}
      attachments={props.attachments ?? []}
      refreshAttachments={props.refreshAttachments ?? (async () => undefined)}
      onError={props.onError}
    >
      <PdfDocumentWorkbenchView
        {...props}
        contributionOwnerId={pdfWorkbenchManifest.id}
      />
    </DocumentAiWorkbenchShell>
  );
}

const pdfWorkbenchModule: RendererWorkbenchModule<
  typeof pdfWorkbenchManifest.id
> = {
  manifest: pdfWorkbenchManifest,
  View: PdfWorkbenchView,
};

export default pdfWorkbenchModule;
