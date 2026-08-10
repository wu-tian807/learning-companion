import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Book,
  Contents,
  Location,
  NavItem,
  Rendition,
} from 'epubjs';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { useWorkbenchContributions } from '../../renderer/workbench/runtime/use-workbench-contributions';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
import { userMessageFromError } from '../../shared/ipc-error';
import {
  isEpubCfiRangeTarget,
  type EpubExplanationView,
} from '../../shared/epub-explanations';
import {
  interactionFromTextSelection,
  type WorkbenchSelectionSnapshot,
} from '../../shared/workbench/selection';
import {
  captureEpubSelectionSnapshot,
  createEpubSelectionSnapshot,
  resolveEpubContextMenuPosition,
} from './epub-interaction';
import {
  hasExplicitUrlScheme,
  isExternalNetworkUrl,
  secureEpubDocument,
  toSafeExternalUrl,
} from './epub-security';
import { createEpubRendererActions } from './renderer-actions';
import {
  cloneEpubViewState,
  createEpubSaveViewStateCommand,
  DEFAULT_EPUB_VIEW_STATE,
  epubWorkbenchManifest,
  isEpubSaveViewStateResult,
  isEpubWorkbenchPayload,
  type EpubTheme,
  type EpubWorkbenchViewState,
} from './shared';

type EpubLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly message: string };

interface EpubMetadata {
  readonly title: string;
  readonly creator?: string;
}

interface FlatNavItem {
  readonly href: string;
  readonly label: string;
  readonly depth: number;
}

const SAVE_DELAY_MS = 500;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function flattenNavigation(
  items: readonly NavItem[],
  depth = 0,
): FlatNavItem[] {
  return items.flatMap((item) => [
    {
      href: item.href,
      label: item.label.trim() || '未命名章节',
      depth,
    },
    ...flattenNavigation(item.subitems ?? [], depth + 1),
  ]);
}

function themeRules(theme: EpubTheme): object {
  const palette = {
    dark: {
      background: '#151a20',
      foreground: '#cbd5e1',
      muted: '#94a3b8',
      link: '#a5b4fc',
    },
    light: {
      background: '#f7f5ef',
      foreground: '#292824',
      muted: '#69665e',
      link: '#4f46e5',
    },
    sepia: {
      background: '#f2ead7',
      foreground: '#40392e',
      muted: '#756a58',
      link: '#765caa',
    },
  }[theme];

  return {
    html: {
      'background-color': `${palette.background} !important`,
    },
    body: {
      'background-color': `${palette.background} !important`,
      color: `${palette.foreground} !important`,
      'line-height': '1.8 !important',
      padding: '0 4% !important',
    },
    'a, a:visited': {
      color: `${palette.link} !important`,
    },
    'blockquote, figcaption': {
      color: `${palette.muted} !important`,
    },
    'img, svg': {
      'max-width': '100% !important',
      height: 'auto !important',
    },
  };
}

function EpubToc({
  items,
  onSelect,
}: {
  readonly items: readonly FlatNavItem[];
  readonly onSelect: (href: string) => void;
}) {
  return (
    <aside
      aria-label="EPUB 目录"
      className="w-60 shrink-0 overflow-y-auto border-r border-white/[0.07] bg-[#171c22] p-2"
    >
      <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
        目录
      </p>
      {items.length === 0 ? (
        <p className="px-2 py-4 text-xs leading-5 text-slate-600">
          这本书没有可用目录。
        </p>
      ) : (
        items.map((item, index) => (
          <button
            key={`${item.href}:${index}`}
            type="button"
            title={item.label}
            onClick={() => onSelect(item.href)}
            className="ui-menu-item block w-full truncate rounded-md py-1.5 pr-2 text-left text-[11px] leading-5 text-slate-400"
            style={{ paddingLeft: `${8 + Math.min(item.depth, 5) * 12}px` }}
          >
            {item.label}
          </button>
        ))
      )}
    </aside>
  );
}

function EpubExplanationCard({
  explanation,
  onClose,
  onRetry,
  onDelete,
}: {
  readonly explanation: EpubExplanationView;
  readonly onClose: () => void;
  readonly onRetry: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <aside
      aria-label="AI 解释"
      className="absolute right-4 top-4 z-20 w-[min(380px,calc(100%-2rem))] overflow-hidden rounded-2xl border border-white/[0.1] bg-[#20262e]/95 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-slate-100">解释这段话</p>
          <p className="mt-0.5 max-w-[280px] truncate text-[10px] text-slate-500">
            “{explanation.target.anchorPayload.quote.exact}”
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭 AI 解释"
          onClick={onClose}
          className="ui-icon-button grid size-7 place-items-center rounded-full text-sm text-slate-500"
        >
          ×
        </button>
      </div>

      <div className="max-h-[min(55vh,460px)] overflow-y-auto px-4 py-4">
        {explanation.status === 'pending' && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="size-3 animate-spin rounded-full border border-slate-500 border-t-indigo-200" />
            AI 正在解释选中的文字…
          </div>
        )}
        {explanation.status === 'completed' && (
          <div className="whitespace-pre-wrap text-[13px] leading-6 text-slate-200">
            {explanation.answer ?? '回答文件暂时不可用。'}
          </div>
        )}
        {explanation.status === 'failed' && (
          <div>
            <p className="text-xs leading-5 text-rose-300">
              {explanation.failureMessage ?? 'AI 解释失败，请重试。'}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="ui-control mt-3 rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300"
            >
              重试
            </button>
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-white/[0.07] px-3 py-2">
        <button
          type="button"
          onClick={onDelete}
          className="ui-control rounded-full px-3 py-1.5 text-[11px] text-slate-500 hover:text-rose-300"
        >
          删除解释
        </button>
      </div>
    </aside>
  );
}

export function EpubWorkbenchView({
  asset,
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
  const payload = isEpubWorkbenchPayload(bootstrap.payload)
    ? bootstrap.payload
    : undefined;
  const viewerHostRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | undefined>(undefined);
  const bookRef = useRef<Book | undefined>(undefined);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const selectionRef = useRef<
    WorkbenchSelectionSnapshot | undefined
  >(undefined);
  const viewStateRef = useRef<EpubWorkbenchViewState>(
    payload?.viewState ?? cloneEpubViewState(DEFAULT_EPUB_VIEW_STATE),
  );
  const [viewState, setViewState] = useState<EpubWorkbenchViewState>(
    viewStateRef.current,
  );
  const [loadState, setLoadState] = useState<EpubLoadState>({
    kind: 'loading',
  });
  const [metadata, setMetadata] = useState<EpubMetadata>({
    title: 'EPUB',
  });
  const [navigation, setNavigation] = useState<FlatNavItem[]>([]);
  const [progress, setProgress] = useState<number>();
  const [readerRevision, setReaderRevision] = useState(0);
  const [explanations, setExplanations] = useState<
    EpubExplanationView[]
  >([]);
  const [activeExplanationId, setActiveExplanationId] = useState<string>();

  const reportError = useCallback(
    (error: unknown, fallback: string) => {
      const message = userMessageFromError(error, fallback);
      if (message) {
        console.error(message, error);
        onError(message);
      }
    },
    [onError],
  );

  const persistViewState = useCallback(
    async (state: EpubWorkbenchViewState) => {
      try {
        const result = await executeCommand(
          createEpubSaveViewStateCommand(state),
        );
        if (!isEpubSaveViewStateResult(result.payload)) {
          throw new Error('EPUB Workbench 视图状态响应无效');
        }
      } catch (error) {
        reportError(error, '无法保存 EPUB 阅读位置。');
      }
    },
    [executeCommand, reportError],
  );

  const updateViewState = useCallback(
    (next: EpubWorkbenchViewState, immediate = false) => {
      viewStateRef.current = next;
      setViewState(next);

      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      if (immediate) {
        void persistViewState(next);
      } else {
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = undefined;
          void persistViewState(viewStateRef.current);
        }, SAVE_DELAY_MS);
      }
    },
    [persistViewState],
  );

  const reload = useCallback(() => {
    selectionRef.current = undefined;
    onInteractionChange({ inputs: [] });
    runtime.closeContextMenu();
    setReaderRevision((current) => current + 1);
  }, [onInteractionChange, runtime]);

  const reveal = useCallback(async () => {
    try {
      await onReveal();
    } catch (error) {
      reportError(error, '无法在文件夹中显示 EPUB 文件。');
    }
  }, [onReveal, reportError]);

  const copySelection = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        reportError(error, '无法复制 EPUB 选中内容。');
      }
    },
    [reportError],
  );

  const explainSelection = useCallback(
    async (selection: WorkbenchSelectionSnapshot) => {
      if (!isEpubCfiRangeTarget(selection.target)) {
        reportError(
          new Error('EPUB 选区锚点无效'),
          '无法解释这个 EPUB 选区。',
        );
        return;
      }
      const target = selection.target;

      const existing = explanations.find(
        (candidate) =>
          candidate.target.anchorPayload.cfiRange ===
          target.anchorPayload.cfiRange,
      );
      if (existing) {
        setActiveExplanationId(existing.id);
        return;
      }

      try {
        const created = await window.learningCompanion.createEpubExplanation({
          projectId: asset.projectId,
          assetId: asset.id,
          target,
        });
        setExplanations((current) => [
          ...current.filter((item) => item.id !== created.id),
          created,
        ]);
        setActiveExplanationId(created.id);
      } catch (error) {
        reportError(error, '无法启动 AI 解释。');
      }
    },
    [asset.id, asset.projectId, explanations, reportError],
  );

  const rendererActions = useMemo(
    () =>
      createEpubRendererActions({
        ready: loadState.kind === 'ready',
        hasSelection: () => selectionRef.current !== undefined,
        onCopySelection: copySelection,
        onExplainSelection: explainSelection,
        onReload: reload,
        onReveal: reveal,
      }),
    [copySelection, explainSelection, loadState.kind, reload, reveal],
  );
  useWorkbenchContributions(
    `${epubWorkbenchManifest.id}.viewer`,
    rendererActions,
  );

  useEffect(() => {
    let active = true;
    const removeSubscription =
      window.learningCompanion.onEpubExplanationChanged((event) => {
        if (event.type === 'changed') {
          if (
            event.explanation.projectId !== asset.projectId ||
            event.explanation.assetId !== asset.id
          ) {
            return;
          }
          setExplanations((current) => [
            ...current.filter(
              (item) => item.id !== event.explanation.id,
            ),
            event.explanation,
          ]);
          return;
        }
        if (
          event.projectId !== asset.projectId ||
          event.assetId !== asset.id
        ) {
          return;
        }
        setExplanations((current) =>
          current.filter((item) => item.id !== event.explanationId),
        );
        setActiveExplanationId((current) =>
          current === event.explanationId ? undefined : current,
        );
      });

    void window.learningCompanion
      .listEpubExplanations({
        projectId: asset.projectId,
        assetId: asset.id,
      })
      .then((items) => {
        if (active) {
          setExplanations([...items]);
        }
      })
      .catch((error) => {
        if (active) {
          reportError(error, '无法加载 EPUB 的 AI 解释。');
        }
      });

    return () => {
      active = false;
      removeSubscription();
      setExplanations([]);
      setActiveExplanationId(undefined);
    };
  }, [asset.id, asset.projectId, reportError]);

  useEffect(() => {
    const host = viewerHostRef.current;
    if (!payload || !host) {
      return;
    }

    const abortController = new AbortController();
    let disposed = false;
    let book: Book | undefined;
    let rendition: Rendition | undefined;
    const contentCleanups: Array<() => void> = [];
    host.replaceChildren();
    setLoadState({ kind: 'loading' });
    setProgress(undefined);

    void (async () => {
      const response = await fetch(payload.contentUrl, {
        signal: abortController.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`EPUB 内容读取失败（${response.status}）`);
      }

      const buffer = await response.arrayBuffer();
      const { default: createBook } = await import('epubjs');
      if (disposed) {
        return;
      }
      book = createBook(buffer);
      bookRef.current = book;
      await book.opened;
      if (disposed) {
        return;
      }

      book.spine.hooks.content.register(
        (document: Document) => secureEpubDocument(document),
      );
      const [bookMetadata, bookNavigation] = await Promise.all([
        book.loaded.metadata,
        book.loaded.navigation,
      ]);
      if (disposed) {
        return;
      }

      setMetadata({
        title: bookMetadata.title?.trim() || '未命名 EPUB',
        ...(bookMetadata.creator?.trim()
          ? { creator: bookMetadata.creator.trim() }
          : {}),
      });
      setNavigation(flattenNavigation(bookNavigation.toc ?? []));

      rendition = book.renderTo(host, {
        width: '100%',
        height: '100%',
        manager:
          viewStateRef.current.flow === 'paginated'
            ? 'default'
            : 'continuous',
        flow: viewStateRef.current.flow,
        spread: 'none',
        allowScriptedContent: false,
      });
      renditionRef.current = rendition;
      for (const theme of ['dark', 'light', 'sepia'] as const) {
        rendition.themes.register(theme, themeRules(theme));
      }
      rendition.themes.select(viewStateRef.current.theme);
      rendition.themes.fontSize(
        `${Math.round(viewStateRef.current.fontScale * 100)}%`,
      );

      rendition.hooks.content.register((contents: Contents) => {
        for (const anchor of contents.document.querySelectorAll('a')) {
          anchor.removeAttribute('target');
          anchor.removeAttribute('download');
        }
        const clickHandler = (event: MouseEvent) => {
          const target = event.target as Element | null;
          const anchor =
            target && typeof target.closest === 'function'
              ? target.closest('a[href]')
              : null;
          const href = anchor?.getAttribute('href') ?? '';
          const externalUrl = toSafeExternalUrl(href);

          if (
            !externalUrl &&
            !isExternalNetworkUrl(href) &&
            !hasExplicitUrlScheme(href)
          ) {
            return;
          }
          event.preventDefault();
          event.stopImmediatePropagation();
          if (externalUrl) {
            void onOpenExternal(externalUrl);
          }
        };
        const contextMenuHandler = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();

          const selection =
            captureEpubSelectionSnapshot(contents);
          const interaction =
            interactionFromTextSelection(selection);
          selectionRef.current = selection;
          onInteractionChange(interaction);
          runtime.openContextMenu(
            bootstrap.sessionId,
            resolveEpubContextMenuPosition(event, contents),
            interaction,
            { captureOutsidePointer: true },
          );
        };
        contents.document.addEventListener('click', clickHandler, true);
        contents.document.addEventListener(
          'contextmenu',
          contextMenuHandler,
          true,
        );
        contentCleanups.push(() => {
          contents.document.removeEventListener(
            'click',
            clickHandler,
            true,
          );
          contents.document.removeEventListener(
            'contextmenu',
            contextMenuHandler,
            true,
          );
        });
      });
      rendition.on('relocated', (location: Location) => {
        if (disposed || !location?.start?.cfi) {
          return;
        }
        const percentage = location.start.percentage;
        setProgress(
          Number.isFinite(percentage)
            ? clamp(percentage, 0, 1)
            : undefined,
        );
        updateViewState(
          {
            ...viewStateRef.current,
            location: location.start.cfi,
          },
          false,
        );
      });
      rendition.on(
        'selected',
        (cfiRange: string, contents: Contents) => {
          const selection = createEpubSelectionSnapshot(
            cfiRange,
            contents,
          );
          selectionRef.current = selection;
          onInteractionChange(
            interactionFromTextSelection(selection),
          );
        },
      );

      try {
        await rendition.display(viewStateRef.current.location);
      } catch (error) {
        if (!viewStateRef.current.location) {
          throw error;
        }
        updateViewState(
          {
            ...viewStateRef.current,
            location: undefined,
          },
          true,
        );
        await rendition.display();
      }
      if (!disposed) {
        setLoadState({ kind: 'ready' });
      }
    })().catch((error: unknown) => {
      if (!disposed && !abortController.signal.aborted) {
        const message = userMessageFromError(
          error,
          'EPUB 文件解析失败，文件可能已损坏。',
        );
        setLoadState({
          kind: 'failed',
          message: message ?? 'EPUB 文件解析失败。',
        });
      }
    });

    return () => {
      disposed = true;
      abortController.abort();
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      void persistViewState(viewStateRef.current);
      selectionRef.current = undefined;
      onInteractionChange({ inputs: [] });
      for (const cleanup of contentCleanups) {
        cleanup();
      }
      renditionRef.current = undefined;
      bookRef.current = undefined;
      book?.destroy();
      host.replaceChildren();
    };
  }, [
    onOpenExternal,
    onInteractionChange,
    payload,
    persistViewState,
    readerRevision,
    runtime,
    bootstrap.sessionId,
    updateViewState,
    viewState.flow,
  ]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    rendition.themes.select(viewState.theme);
    rendition.themes.fontSize(
      `${Math.round(viewState.fontScale * 100)}%`,
    );
  }, [viewState.fontScale, viewState.theme]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || loadState.kind !== 'ready') {
      return;
    }

    for (const explanation of explanations) {
      const cfiRange = explanation.target.anchorPayload.cfiRange;
      const color =
        explanation.status === 'failed'
          ? '#fb7185'
          : explanation.status === 'pending'
            ? '#94a3b8'
            : '#93c5fd';
      rendition.annotations.underline(
        cfiRange,
        { explanationId: explanation.id },
        () => setActiveExplanationId(explanation.id),
        `epub-ai-explanation-${explanation.status}`,
        {
          stroke: color,
          'stroke-width': '2',
          'stroke-opacity': '0.7',
          ...(explanation.status !== 'completed'
            ? { 'stroke-dasharray': '3 3' }
            : {}),
        },
      );
    }

    return () => {
      for (const explanation of explanations) {
        rendition.annotations.remove(
          explanation.target.anchorPayload.cfiRange,
          'underline',
        );
      }
    };
  }, [explanations, loadState.kind]);

  const retryExplanation = useCallback(
    async (explanation: EpubExplanationView) => {
      try {
        const retried =
          await window.learningCompanion.retryEpubExplanation({
            projectId: asset.projectId,
            assetId: asset.id,
            explanationId: explanation.id,
          });
        setExplanations((current) => [
          ...current.filter((item) => item.id !== retried.id),
          retried,
        ]);
      } catch (error) {
        reportError(error, '无法重试 AI 解释。');
      }
    },
    [asset.id, asset.projectId, reportError],
  );

  const deleteExplanation = useCallback(
    async (explanation: EpubExplanationView) => {
      try {
        await window.learningCompanion.deleteEpubExplanation({
          projectId: asset.projectId,
          assetId: asset.id,
          explanationId: explanation.id,
        });
        setExplanations((current) =>
          current.filter((item) => item.id !== explanation.id),
        );
        setActiveExplanationId(undefined);
      } catch (error) {
        reportError(error, '无法删除 AI 解释。');
      }
    },
    [asset.id, asset.projectId, reportError],
  );

  const navigate = useCallback(
    (direction: 'previous' | 'next') => {
      const rendition = renditionRef.current;
      if (!rendition) {
        return;
      }
      const task =
        direction === 'previous' ? rendition.prev() : rendition.next();
      void task.catch((error: unknown) =>
        reportError(error, '无法切换 EPUB 页面。'),
      );
    },
    [reportError],
  );

  const themeOptions = useMemo(
    () =>
      [
        { value: 'dark' as const, label: '深色' },
        { value: 'light' as const, label: '浅色' },
        { value: 'sepia' as const, label: '纸张' },
      ],
    [],
  );
  const activeExplanation = explanations.find(
    (explanation) => explanation.id === activeExplanationId,
  );

  if (!payload) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-rose-300">
          EPUB Workbench 数据无效
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#151a20]">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] bg-[#1a2027] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label="切换 EPUB 目录"
            aria-expanded={viewState.tocOpen}
            onClick={() =>
              updateViewState(
                {
                  ...viewStateRef.current,
                  tocOpen: !viewStateRef.current.tocOpen,
                },
                true,
              )
            }
            className="ui-control rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-slate-400"
          >
            目录
          </button>
          <span className="truncate text-[11px] text-slate-400">
            {metadata.title}
            {metadata.creator ? ` · ${metadata.creator}` : ''}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() =>
              updateViewState(
                {
                  ...viewStateRef.current,
                  flow:
                    viewStateRef.current.flow === 'paginated'
                      ? 'scrolled-doc'
                      : 'paginated',
                },
                true,
              )
            }
            className="ui-control rounded-md px-2 py-1 text-[10px] text-slate-500"
          >
            {viewState.flow === 'paginated' ? '分页' : '连续'}
          </button>
          <select
            aria-label="EPUB 主题"
            value={viewState.theme}
            onChange={(event) =>
              updateViewState(
                {
                  ...viewStateRef.current,
                  theme: event.target.value as EpubTheme,
                },
                true,
              )
            }
            className="ui-control rounded-md border border-white/[0.08] bg-[#20262e] px-1.5 py-1 text-[10px] text-slate-400"
          >
            {themeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="缩小 EPUB 正文"
            onClick={() =>
              updateViewState(
                {
                  ...viewStateRef.current,
                  fontScale: clamp(
                    viewStateRef.current.fontScale - 0.1,
                    0.75,
                    2,
                  ),
                },
                true,
              )
            }
            className="ui-icon-button grid size-7 place-items-center rounded-md text-[11px] text-slate-500"
          >
            A−
          </button>
          <button
            type="button"
            aria-label="放大 EPUB 正文"
            onClick={() =>
              updateViewState(
                {
                  ...viewStateRef.current,
                  fontScale: clamp(
                    viewStateRef.current.fontScale + 0.1,
                    0.75,
                    2,
                  ),
                },
                true,
              )
            }
            className="ui-icon-button grid size-7 place-items-center rounded-md text-[11px] text-slate-500"
          >
            A+
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {viewState.tocOpen && (
          <EpubToc
            items={navigation}
            onSelect={(href) => {
              const rendition = renditionRef.current;
              if (rendition) {
                void rendition.display(href).catch((error: unknown) =>
                  reportError(error, '无法打开这个 EPUB 章节。'),
                );
              }
            }}
          />
        )}
        <div className="relative min-w-0 flex-1">
          <div
            ref={viewerHostRef}
            aria-label="EPUB 阅读区域"
            className="h-full min-h-0 w-full"
          />

          {viewState.flow === 'paginated' &&
            loadState.kind === 'ready' && (
              <>
                <button
                  type="button"
                  aria-label="上一页"
                  onClick={() => navigate('previous')}
                  className="ui-icon-button absolute left-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-white/[0.07] bg-[#20262e]/75 text-lg text-slate-500 shadow-lg backdrop-blur"
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="下一页"
                  onClick={() => navigate('next')}
                  className="ui-icon-button absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-white/[0.07] bg-[#20262e]/75 text-lg text-slate-500 shadow-lg backdrop-blur"
                >
                  ›
                </button>
              </>
            )}

          {progress !== undefined && (
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-white/[0.06] bg-[#20262e]/75 px-2.5 py-1 text-[10px] tabular-nums text-slate-500 backdrop-blur">
              {Math.round(progress * 100)}%
            </div>
          )}

          {activeExplanation && (
            <EpubExplanationCard
              explanation={activeExplanation}
              onClose={() => setActiveExplanationId(undefined)}
              onRetry={() => void retryExplanation(activeExplanation)}
              onDelete={() => void deleteExplanation(activeExplanation)}
            />
          )}
        </div>
      </div>

      {loadState.kind === 'loading' && (
        <div className="pointer-events-none absolute inset-11 top-11 grid place-items-center bg-[#151a20]/78">
          <div className="flex items-center gap-2.5 rounded-full border border-white/[0.07] bg-[#20262e]/80 px-4 py-2 text-xs text-slate-400 shadow-xl backdrop-blur-sm">
            <span className="size-3 animate-spin rounded-full border border-slate-500 border-t-indigo-200" />
            正在解析 EPUB…
          </div>
        </div>
      )}

      {loadState.kind === 'failed' && (
        <div className="absolute inset-11 top-11 grid place-items-center bg-[#151a20]/95 p-8 text-center">
          <div>
            <p className="text-sm font-medium text-slate-200">
              无法打开 EPUB
            </p>
            <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">
              {loadState.message}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={onRefresh}
                className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300"
              >
                刷新
              </button>
              <button
                type="button"
                onClick={onRelink}
                className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300"
              >
                重新定位
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const epubRendererWorkbenchModule: RendererWorkbenchModule<
  typeof epubWorkbenchManifest.id
> = {
  manifest: epubWorkbenchManifest,
  View: EpubWorkbenchView,
};

export default epubRendererWorkbenchModule;
