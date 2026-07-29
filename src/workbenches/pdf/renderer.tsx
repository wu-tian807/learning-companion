import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { useWorkbenchContributions } from '../../renderer/workbench/runtime/use-workbench-contributions';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
import { userMessageFromError } from '../../shared/ipc-error';
import {
  findTextSelectionInput,
  interactionFromTextSelection,
} from '../../shared/workbench/selection';
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
  isPdfSaveViewStateResult,
  isPdfWorkbenchPayload,
  pdfWorkbenchManifest,
  type PdfReadingMode,
  type PdfScaleMode,
  type PdfSidebar,
  type PdfWorkbenchViewState,
} from './shared';
import { createPdfRendererActions } from './renderer-actions';

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

export function PdfWorkbenchView({
  bootstrap,
  executeCommand,
  onRelink,
  onRefresh,
  onReveal,
  onInteractionChange,
  onOpenExternal,
  onError,
}: RendererWorkbenchViewProps) {
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
  const [loadState, setLoadState] = useState<PdfLoadState>({
    kind: 'loading',
  });
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

  const persistViewState = useCallback(
    async (state: PdfWorkbenchViewState, version: number) => {
      try {
        const result = await executeCommand(
          createPdfSaveViewStateCommand(state),
        );

        if (!isPdfSaveViewStateResult(result.payload)) {
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
    [executeCommand, onError],
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
                  interactionFromTextSelection(selection),
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
      onInteractionChange({ inputs: [] });

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
  }, [scaleMenuOpen, searchOpen]);

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
      }),
    [
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
  useWorkbenchContributions('builtin.pdf', rendererActions);

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

      runtime.openContextMenu(
        bootstrap.sessionId,
        { x: event.clientX, y: event.clientY },
        interactionFromTextSelection(selection, focus),
      );
    },
    [bootstrap.sessionId, runtime, viewState.pageNumber],
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
        }
        .learning-pdf-workbench .pdfViewer .page {
          margin: 0 auto 18px;
          border-radius: 2px;
          box-shadow: 0 10px 32px rgba(0, 0, 0, 0.34);
        }
        .learning-pdf-workbench .textLayer ::selection {
          background: rgba(99, 102, 241, 0.38);
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
            className="absolute inset-0 overflow-auto bg-[#14191f] [scrollbar-color:rgba(120,135,165,.48)_rgba(20,25,31,.6)] [scrollbar-gutter:stable] [scrollbar-width:thin]"
            aria-label="PDF 页面画布"
          >
            <div ref={viewerRef} className="pdfViewer" />
          </div>

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

const pdfWorkbenchModule: RendererWorkbenchModule = {
  manifest: pdfWorkbenchManifest,
  View: PdfWorkbenchView,
};

export default pdfWorkbenchModule;
