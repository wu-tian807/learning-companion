import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import CodeMirror, {
  type ReactCodeMirrorRef,
} from '@uiw/react-codemirror';
import 'vditor/dist/index.css';
import './markdown-workbench.css';

import { createEditorActionPreset } from '../../renderer/workbench/actions/editor-action-preset';
import { CodeMirrorEditorActionAdapter } from '../../renderer/workbench/editor/codemirror-action-adapter';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { useWorkbenchConversationContribution } from '../../renderer/conversation/workbench-conversation-context';
import { useWorkbenchContributions } from '../../renderer/workbench/runtime/use-workbench-contributions';
import { DocumentAiWorkbenchShell } from '../document-ai/renderer/DocumentAiWorkbenchShell';
import { QuestionAnchorHost } from '../document-ai/renderer/QuestionAnchorHost';
import {
  createDocumentConversationContext,
  createDocumentConversationContribution,
  createDocumentConversationHistoryStore,
  type DocumentConversationContext,
} from '../document-ai/renderer/conversation/document-conversation-contribution';
import {
  revealSelectionInCodeMirror,
  resolveTextSelectionFromTarget,
  scrollRangeIntoView,
  selectTextInElement,
} from '../document-ai/renderer/conversation/document-anchor-reveal';
import {
  WORKBENCH_REVEAL_ANCHOR_EVENT,
  type RevealWorkbenchAnchorDetail,
} from '../../renderer/workbench/host/workbench-anchor-bridge';
import { userMessageFromError } from '../../shared/ipc-error';
import type { WorkbenchCommandResult } from '../../shared/workbench/protocol';
import { createTextRangeTarget } from '../../shared/workbench/text-range-anchor';
import { MarkdownEditorActionAdapter } from './markdown-editor-action-adapter';
import { MarkdownEditorAdapter } from './markdown-editor-adapter';
import {
  areMarkdownSourceViewStatesEqual,
  cloneMarkdownWorkbenchViewState,
  createMarkdownSaveViewStateCommand,
  createMarkdownSyncSourceCommand,
  createMarkdownSyncWysiwygCommand,
  isMarkdownBufferSyncResult,
  isMarkdownLineEndingResult,
  isMarkdownReopenResult,
  isMarkdownSaveResult,
  isMarkdownSaveViewStateResult,
  isMarkdownWorkbenchPayload,
  markdownCommands,
  markdownWorkbenchManifest,
  MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
  MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
  type MarkdownBufferSyncResult,
  type MarkdownEditMode,
  type MarkdownEncoding,
  type MarkdownLineEnding,
  type MarkdownSourceViewState,
  type MarkdownWorkbenchViewState,
} from './shared';
import {
  createMarkdownRendererActions,
} from './renderer-actions';
import { writeMarkdownAnswerToSource } from './answer-insertion';

type VisualEditorState =
  | 'loading'
  | 'ready'
  | 'failed';

const MARKDOWN_ANSWER_ACTION_PRESENTATION = Object.freeze({
  label: '回归 Markdown 原文',
  selectionLabel: '回归选中回答片段',
  successMessage: '已写回并保存 Markdown 原文',
  failureMessage: '写回 Markdown 原文失败',
});

const markdownSourceTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      color: '#dbe4f3',
      backgroundColor: '#171c22',
      fontSize: '14px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily:
        '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      lineHeight: '1.72',
      scrollbarWidth: 'thin',
      scrollbarColor:
        'rgba(170, 180, 205, 0.75) rgba(20, 25, 32, 0.35)',
      overscrollBehavior: 'contain',
      scrollbarGutter: 'stable',
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '18px 8px 42px',
      caretColor: '#c7d2fe',
    },
    '.cm-line': { padding: '0 16px' },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#c7d2fe',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(129, 140, 248, 0.28) !important',
    },
    '.cm-gutters': {
      color: '#586579',
      backgroundColor: '#171c22',
      borderRight: '1px solid rgba(255,255,255,0.055)',
      paddingLeft: '6px',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255,255,255,0.025)',
    },
    '.cm-activeLineGutter': {
      color: '#aebbd0',
      backgroundColor: 'rgba(255,255,255,0.035)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(250, 204, 21, 0.18)',
      outline: '1px solid rgba(250, 204, 21, 0.25)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(251, 191, 36, 0.32)',
    },
    '.cm-panels': {
      color: '#dbe4f3',
      backgroundColor: '#232a33',
    },
    '.cm-panels input': {
      color: '#f1f5f9',
      backgroundColor: '#15191f',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '6px',
    },
  },
  { dark: true },
);

function sourceViewStateFromUpdate(
  update: ViewUpdate,
): MarkdownSourceViewState {
  const selection = update.state.selection.main;

  return {
    anchor: selection.anchor,
    head: selection.head,
    scrollTop: Math.max(0, update.view.scrollDOM.scrollTop),
  };
}

function cursorLabel(update: ViewUpdate): string {
  const head = update.state.selection.main.head;
  const line = update.state.doc.lineAt(head);
  return `第 ${line.number} 行，第 ${head - line.from + 1} 列`;
}

function formatEncoding(encoding: MarkdownEncoding): string {
  return encoding === 'utf-8' ? 'UTF-8' : 'GBK';
}

function requireValidResult<T extends WorkbenchCommandResult['payload']>(
  result: WorkbenchCommandResult,
  predicate: (value: unknown) => value is T,
  message: string,
): asserts result is WorkbenchCommandResult & { readonly payload: T } {
  if (!predicate(result.payload)) {
    throw new Error(message);
  }
}

interface MarkdownRecoveryDialogProps {
  readonly sourceChanged: boolean;
  readonly updatedTime: number;
  readonly busy: boolean;
  readonly onRestore: () => void;
  readonly onDiscard: () => void;
}

function MarkdownRecoveryDialog({
  sourceChanged,
  updatedTime,
  busy,
  onRestore,
  onDiscard,
}: MarkdownRecoveryDialogProps) {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/70 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="markdown-recovery-title"
        className="w-full max-w-md rounded-2xl border border-white/[0.12] bg-[#242a32] p-5 shadow-[0_26px_80px_rgba(0,0,0,0.55)]"
      >
        <h2
          id="markdown-recovery-title"
          className="text-base font-semibold text-slate-100"
        >
          恢复未保存的 Markdown？
        </h2>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          上次编辑内容已在{' '}
          {new Date(updatedTime).toLocaleString()} 自动备份。
        </p>
        {sourceChanged && (
          <p className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.07] px-3 py-2.5 text-xs leading-5 text-amber-100/80">
            原文件在备份后发生过变化。恢复只会进入编辑器，不会立即覆盖磁盘文件。
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
            className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300 disabled:opacity-45"
          >
            使用磁盘版本
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onRestore}
            className="ui-primary-button rounded-full bg-slate-50 px-5 py-2 text-xs font-semibold text-slate-900 disabled:opacity-45"
          >
            恢复编辑内容
          </button>
        </div>
      </div>
    </div>
  );
}

export function MarkdownWorkbenchView(props: RendererWorkbenchViewProps) {
  const runtime = useWorkbenchRuntime();
  const {
    bootstrap,
    asset,
    executeCommand,
    onReveal,
    onInteractionChange,
    onOpenExternal,
    onError,
    attachments,
    refreshAttachments,
  } = props;
  const payload = isMarkdownWorkbenchPayload(bootstrap.payload)
    ? bootstrap.payload
    : undefined;
  const initialViewState =
    payload?.state ??
    ({
      viewMode: 'wysiwyg',
      wysiwygScrollTop: 0,
      wordWrap: true,
      outlineVisible: false,
    } satisfies MarkdownWorkbenchViewState);
  const sourceEditorRef = useRef<ReactCodeMirrorRef>(null);
  const wysiwygHostRef = useRef<HTMLDivElement>(null);
  const wysiwygAdapterRef = useRef<MarkdownEditorAdapter | undefined>(
    undefined,
  );
  const wysiwygInitializationRef = useRef(0);
  const workingBufferRef = useRef(payload?.diskSource ?? '');
  const lineEndingRef = useRef<MarkdownLineEnding>(
    payload?.lineEnding ?? 'lf',
  );
  const viewStateRef = useRef<MarkdownWorkbenchViewState>(
    cloneMarkdownWorkbenchViewState(initialViewState),
  );
  const wysiwygEditedSinceMountRef = useRef(false);
  const pendingAnswerInsertionRef = useRef<
    | {
        readonly context?: DocumentConversationContext;
        readonly text: string;
        readonly resolve: () => void;
        readonly reject: (error: unknown) => void;
      }
    | undefined
  >(undefined);
  const viewStateSaveTimerRef = useRef<number | undefined>(undefined);
  const [workingBuffer, setWorkingBuffer] = useState(
    payload?.diskSource ?? '',
  );
  const [diskSource, setDiskSource] = useState(
    payload?.diskSource ?? '',
  );
  const [lineEnding, setLineEnding] = useState<MarkdownLineEnding>(
    payload?.lineEnding ?? 'lf',
  );
  const [savedLineEnding, setSavedLineEnding] =
    useState<MarkdownLineEnding>(payload?.lineEnding ?? 'lf');
  const [encoding, setEncoding] = useState<MarkdownEncoding>(
    payload?.encoding ?? 'utf-8',
  );
  const [viewState, setViewState] = useState<MarkdownWorkbenchViewState>(
    initialViewState,
  );
  const [visualEditorState, setVisualEditorState] =
    useState<VisualEditorState>('loading');
  const [recovery, setRecovery] = useState(payload?.recovery);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sourceEditorKey, setSourceEditorKey] = useState(0);
  const [wysiwygEditorKey, setWysiwygEditorKey] = useState(0);
  const [cursor, setCursor] = useState('第 1 行，第 1 列');
  const dirty =
    workingBuffer !== diskSource || lineEnding !== savedLineEnding;

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

  const sourceExtensions = useMemo(() => {
    const extensions = [markdown(), markdownSourceTheme];

    if (viewState.wordWrap) {
      extensions.push(EditorView.lineWrapping);
    }

    return extensions;
  }, [viewState.wordWrap]);

  const sourceEditorActionAdapter = useMemo(
    () =>
      new CodeMirrorEditorActionAdapter({
        getView: () => sourceEditorRef.current?.view,
        isEditable: () => !recovery,
        createTarget: ({ source, ranges }) =>
          createTextRangeTarget(
            MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
            source,
            ranges.map((range) => ({
              start: range.from,
              end: range.to,
            })),
          ),
      }),
    [recovery],
  );
  const wysiwygEditorActionAdapter = useMemo(
    () =>
      new MarkdownEditorActionAdapter({
        getEditor: () => wysiwygAdapterRef.current,
      }),
    [],
  );
  const activeEditorActionAdapter =
    viewState.viewMode === 'source'
      ? sourceEditorActionAdapter
      : wysiwygEditorActionAdapter;
  const editorActions = useMemo(
    () => createEditorActionPreset(activeEditorActionAdapter),
    [activeEditorActionAdapter],
  );
  useWorkbenchContributions(
    `${markdownWorkbenchManifest.id}.editor`,
    editorActions,
  );

  const openSourceContextMenu = useCallback(
    (event: MouseEvent) => {
      if (recovery) {
        return;
      }

      event.preventDefault();
      const capture = sourceEditorActionAdapter.captureContextMenu(
        event.clientX,
        event.clientY,
      );
      runtime.openContextMenu(
        bootstrap.sessionId,
        { x: event.clientX, y: event.clientY },
        capture.interaction,
        { onWheel: capture.onWheel },
      );
    },
    [
      bootstrap.sessionId,
      recovery,
      runtime,
      sourceEditorActionAdapter,
    ],
  );

  const sourceContextMenuExtension = useMemo(
    () =>
      EditorView.domEventHandlers({
        contextmenu: (event) => {
          openSourceContextMenu(event as MouseEvent);
          return true;
        },
      }),
    [openSourceContextMenu],
  );

  const configuredSourceExtensions = useMemo(
    () => [...sourceExtensions, sourceContextMenuExtension],
    [sourceContextMenuExtension, sourceExtensions],
  );

  const applyViewState = useCallback(
    (next: MarkdownWorkbenchViewState) => {
      const cloned = cloneMarkdownWorkbenchViewState(next);
      viewStateRef.current = cloned;
      setViewState(cloned);
      wysiwygAdapterRef.current?.setOutlineVisible(
        cloned.outlineVisible,
      );
    },
    [],
  );

  const persistViewState = useCallback(
    async (next: MarkdownWorkbenchViewState) => {
      const result = await executeCommand(
        createMarkdownSaveViewStateCommand(next),
      );
      requireValidResult(
        result,
        isMarkdownSaveViewStateResult,
        'Markdown Workbench 视图状态响应无效',
      );
    },
    [executeCommand],
  );

  const scheduleViewStateSave = useCallback(
    (next: MarkdownWorkbenchViewState) => {
      applyViewState(next);
      if (viewStateSaveTimerRef.current !== undefined) {
        window.clearTimeout(viewStateSaveTimerRef.current);
      }
      viewStateSaveTimerRef.current = window.setTimeout(() => {
        viewStateSaveTimerRef.current = undefined;
        void persistViewState(viewStateRef.current).catch((error) => {
          reportError(error, '无法保存 Markdown 阅读位置。');
        });
      }, 450);
    },
    [applyViewState, persistViewState, reportError],
  );

  useEffect(() => {
    return () => {
      if (viewStateSaveTimerRef.current !== undefined) {
        window.clearTimeout(viewStateSaveTimerRef.current);
        viewStateSaveTimerRef.current = undefined;
      }
      void persistViewState(viewStateRef.current).catch((error) => {
        reportError(error, '无法保存 Markdown 最后的阅读位置。');
      });
    };
  }, [persistViewState, reportError]);

  const acceptSyncResult = useCallback(
    (result: WorkbenchCommandResult): MarkdownBufferSyncResult => {
      if (!isMarkdownBufferSyncResult(result.payload)) {
        throw new Error('Markdown Workbench Buffer 同步响应无效');
      }

      return result.payload;
    },
    [],
  );

  const syncSourceBuffer = useCallback(
    async (
      content: string,
      sourceViewState: MarkdownSourceViewState,
    ) => {
      const result = await executeCommand(
        createMarkdownSyncSourceCommand({
          content,
          lineEnding: lineEndingRef.current,
          sourceViewState,
        }),
      );
      return acceptSyncResult(result);
    },
    [acceptSyncResult, executeCommand],
  );

  const syncWysiwygBuffer = useCallback(
    async (content: string, scrollTop: number) => {
      const result = await executeCommand(
        createMarkdownSyncWysiwygCommand({
          content,
          lineEnding: lineEndingRef.current,
          wysiwygScrollTop: scrollTop,
        }),
      );
      return acceptSyncResult(result);
    },
    [acceptSyncResult, executeCommand],
  );

  useEffect(() => {
    if (
      !payload ||
      recovery ||
      viewState.viewMode !== 'wysiwyg' ||
      !wysiwygHostRef.current
    ) {
      return;
    }

    let active = true;
    const initialization = ++wysiwygInitializationRef.current;
    const abortController = new AbortController();
    setVisualEditorState('loading');
    wysiwygEditedSinceMountRef.current = false;
    const host = wysiwygHostRef.current;
    const editorHost = document.createElement('div');
    editorHost.style.height = '100%';
    editorHost.style.minHeight = '0';
    host.replaceChildren(editorHost);
    let ownedAdapter: MarkdownEditorAdapter | undefined;

    void MarkdownEditorAdapter.create({
      host: editorHost,
      initialValue: workingBufferRef.current,
      initialScrollTop: viewStateRef.current.wysiwygScrollTop,
      outlineVisible: viewStateRef.current.outlineVisible,
      onInput: (value) => {
        if (
          !active ||
          wysiwygInitializationRef.current !== initialization
        ) {
          return;
        }

        const adapter = wysiwygAdapterRef.current;
        const scrollTop = adapter?.getScrollTop() ?? 0;
        workingBufferRef.current = value;
        wysiwygEditedSinceMountRef.current = true;
        setWorkingBuffer(value);
        void syncWysiwygBuffer(value, scrollTop).catch((error) => {
          reportError(error, '无法同步 Markdown 可视化编辑内容。');
        });
      },
      onScroll: (scrollTop) => {
        if (
          !active ||
          wysiwygInitializationRef.current !== initialization
        ) {
          return;
        }

        runtime.closeContextMenu();
        scheduleViewStateSave({
          ...viewStateRef.current,
          viewMode: 'wysiwyg',
          wysiwygScrollTop: scrollTop,
        });
      },
      onOpenExternal: (url) => {
        void onOpenExternal(url).catch((error) => {
          reportError(error, '无法打开外部链接。');
        });
      },
      onError: (error) => {
        reportError(error, 'Markdown 可视化编辑器运行异常。');
      },
      signal: abortController.signal,
    })
      .then((adapter) => {
        ownedAdapter = adapter;
        if (
          !active ||
          wysiwygInitializationRef.current !== initialization
        ) {
          adapter.destroy();
          return;
        }

        wysiwygAdapterRef.current = adapter;
        setVisualEditorState('ready');
      })
      .catch((error) => {
        if (
          !active ||
          wysiwygInitializationRef.current !== initialization ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }

        editorHost.replaceChildren();
        setVisualEditorState('failed');
        reportError(error, '无法启动 Markdown 可视化编辑器。');
      });

    return () => {
      active = false;
      abortController.abort();
      if (wysiwygAdapterRef.current === ownedAdapter) {
        wysiwygAdapterRef.current = undefined;
      }
      ownedAdapter?.destroy();
      editorHost.remove();
    };
  }, [
    onOpenExternal,
    payload,
    recovery,
    reportError,
    runtime,
    scheduleViewStateSave,
    syncWysiwygBuffer,
    viewState.viewMode,
    wysiwygEditorKey,
  ]);

  useEffect(() => {
    if (
      recovery ||
      viewState.viewMode !== 'wysiwyg' ||
      visualEditorState !== 'ready'
    ) {
      return;
    }

    const element =
      wysiwygAdapterRef.current?.getEditableElement();

    if (!element) {
      return;
    }

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const capture =
        wysiwygEditorActionAdapter.captureContextMenu(
          event.clientX,
          event.clientY,
        );
      runtime.openContextMenu(
        bootstrap.sessionId,
        { x: event.clientX, y: event.clientY },
        capture.interaction,
        { onWheel: capture.onWheel },
      );
    };
    const publishSelection = () => {
      const selection =
        element.ownerDocument.defaultView?.getSelection();

      if (!selection || selection.rangeCount === 0) {
        return;
      }

      const range = selection.getRangeAt(0);

      if (
        !element.contains(range.startContainer) ||
        !element.contains(range.endContainer)
      ) {
        return;
      }

      onInteractionChange(
        wysiwygEditorActionAdapter.captureInteraction(),
      );
    };

    element.addEventListener('contextmenu', onContextMenu);
    element.ownerDocument.addEventListener(
      'selectionchange',
      publishSelection,
    );
    publishSelection();

    return () => {
      element.removeEventListener('contextmenu', onContextMenu);
      element.ownerDocument.removeEventListener(
        'selectionchange',
        publishSelection,
      );
    };
  }, [
    bootstrap.sessionId,
    onInteractionChange,
    recovery,
    runtime,
    visualEditorState,
    viewState.viewMode,
    wysiwygEditorActionAdapter,
  ]);

  const updateViewState = useCallback(
    async (next: MarkdownWorkbenchViewState) => {
      applyViewState(next);
      try {
        await persistViewState(next);
      } catch (error) {
        reportError(error, '无法更新 Markdown 编辑器选项。');
        throw error;
      }
    },
    [applyViewState, persistViewState, reportError],
  );

  const switchMode = useCallback(
    async (mode: MarkdownEditMode) => {
      if (mode === viewStateRef.current.viewMode || recovery) {
        return;
      }

      try {
        if (viewStateRef.current.viewMode === 'source') {
          const sourceState =
            viewStateRef.current.sourceViewState ?? {
              anchor: 0,
              head: 0,
              scrollTop: 0,
            };
          await syncSourceBuffer(
            workingBufferRef.current,
            sourceState,
          );
        } else if (wysiwygEditedSinceMountRef.current) {
          await syncWysiwygBuffer(
            workingBufferRef.current,
            wysiwygAdapterRef.current?.getScrollTop() ?? 0,
          );
        }

        const next = {
          ...viewStateRef.current,
          viewMode: mode,
        };
        onInteractionChange({ inputs: [] });
        applyViewState(next);
        await persistViewState(next);

        if (mode === 'source') {
          setSourceEditorKey((current) => current + 1);
        } else {
          setWysiwygEditorKey((current) => current + 1);
        }
      } catch (error) {
        reportError(error, '无法切换 Markdown 编辑模式。');
        throw error;
      }
    },
    [
      applyViewState,
      bootstrap.sessionId,
      onInteractionChange,
      persistViewState,
      recovery,
      reportError,
      runtime,
      syncSourceBuffer,
      syncWysiwygBuffer,
    ],
  );

  const flushCurrentBuffer = useCallback(async () => {
    if (viewStateRef.current.viewMode === 'source') {
      return syncSourceBuffer(
        workingBufferRef.current,
        viewStateRef.current.sourceViewState ?? {
          anchor: 0,
          head: 0,
          scrollTop: 0,
        },
      );
    }

    if (wysiwygEditedSinceMountRef.current) {
      return syncWysiwygBuffer(
        workingBufferRef.current,
        wysiwygAdapterRef.current?.getScrollTop() ?? 0,
      );
    }

    return {
      accepted: true as const,
      dirty,
    };
  }, [dirty, syncSourceBuffer, syncWysiwygBuffer]);

  const save = useCallback(async () => {
    if (!dirty || saving || recovery) {
      return;
    }

    setSaving(true);
    try {
      await flushCurrentBuffer();

      const result = await executeCommand({
        type: markdownCommands.save,
      });
      requireValidResult(
        result,
        isMarkdownSaveResult,
        'Markdown Workbench 保存响应无效',
      );
      setDiskSource(workingBufferRef.current);
      setSavedLineEnding(lineEndingRef.current);
      wysiwygEditedSinceMountRef.current = false;
    } catch (error) {
      reportError(error, '无法保存 Markdown 文件。');
    } finally {
      setSaving(false);
    }
  }, [
    dirty,
    executeCommand,
    flushCurrentBuffer,
    recovery,
    reportError,
    saving,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault();
        void save();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [save]);

  const onSourceChange = useCallback(
    (value: string, update: ViewUpdate) => {
      const sourceState = sourceViewStateFromUpdate(update);
      workingBufferRef.current = value;
      setWorkingBuffer(value);
      viewStateRef.current = {
        ...viewStateRef.current,
        viewMode: 'source',
        sourceViewState: sourceState,
      };
      setViewState(viewStateRef.current);
      setCursor(cursorLabel(update));
      void syncSourceBuffer(value, sourceState).catch((error) => {
        reportError(error, '无法同步 Markdown 源码内容。');
      });
    },
    [reportError, syncSourceBuffer],
  );

  const onSourceUpdate = useCallback(
    (update: ViewUpdate) => {
      if (update.selectionSet) {
        onInteractionChange(
          sourceEditorActionAdapter.captureInteraction(),
        );
      }

      if (update.docChanged) {
        return;
      }

      if (update.viewportChanged || update.geometryChanged) {
        runtime.closeContextMenu();
      }
      const sourceState = sourceViewStateFromUpdate(update);
      setCursor(cursorLabel(update));
      const currentSourceState =
        viewStateRef.current.sourceViewState;

      if (
        viewStateRef.current.viewMode === 'source' &&
        areMarkdownSourceViewStatesEqual(
          currentSourceState,
          sourceState,
        )
      ) {
        return;
      }

      scheduleViewStateSave({
        ...viewStateRef.current,
        viewMode: 'source',
        sourceViewState: sourceState,
      });
    },
    [
      onInteractionChange,
      runtime,
      scheduleViewStateSave,
      sourceEditorActionAdapter,
    ],
  );

  const restoreRecovery = useCallback(async () => {
    if (!recovery) {
      return;
    }

    setRecoveryBusy(true);
    try {
      workingBufferRef.current = recovery.content;
      lineEndingRef.current = recovery.lineEnding;
      setWorkingBuffer(recovery.content);
      setLineEnding(recovery.lineEnding);

      if (recovery.editedFrom === 'source') {
        await syncSourceBuffer(
          recovery.content,
          viewStateRef.current.sourceViewState ?? {
            anchor: 0,
            head: 0,
            scrollTop: 0,
          },
        );
      } else {
        await syncWysiwygBuffer(
          recovery.content,
          viewStateRef.current.wysiwygScrollTop,
        );
      }

      const mode = recovery.editedFrom;
      const nextViewState = {
        ...viewStateRef.current,
        viewMode: mode,
      };
      applyViewState(nextViewState);
      await persistViewState(nextViewState);
      setRecovery(undefined);
      if (mode === 'source') {
        setSourceEditorKey((current) => current + 1);
      } else {
        setWysiwygEditorKey((current) => current + 1);
      }
    } catch (error) {
      reportError(error, '无法恢复 Markdown 编辑内容。');
    } finally {
      setRecoveryBusy(false);
    }
  }, [
    applyViewState,
    persistViewState,
    recovery,
    reportError,
    syncSourceBuffer,
    syncWysiwygBuffer,
  ]);

  const discardRecovery = useCallback(async () => {
    setRecoveryBusy(true);
    try {
      const result = await executeCommand({
        type: markdownCommands.discardRecovery,
      });

      if (
        typeof result.payload !== 'object' ||
        result.payload === null ||
        !('discarded' in result.payload) ||
        result.payload.discarded !== true
      ) {
        throw new Error('Markdown Workbench 放弃恢复响应无效');
      }

      setRecovery(undefined);
    } catch (error) {
      reportError(error, '无法放弃 Markdown 恢复内容。');
    } finally {
      setRecoveryBusy(false);
    }
  }, [executeCommand, reportError]);

  const updateLineEnding = useCallback(
    async (next: MarkdownLineEnding) => {
      try {
        const result = await executeCommand({
          type: markdownCommands.setLineEnding,
          payload: { lineEnding: next },
        });
        requireValidResult(
          result,
          isMarkdownLineEndingResult,
          'Markdown Workbench 行尾序列响应无效',
        );
        lineEndingRef.current = result.payload.lineEnding;
        setLineEnding(result.payload.lineEnding);
      } catch (error) {
        reportError(error, '无法更新 Markdown 文件的行尾序列。');
        throw error;
      }
    },
    [executeCommand, reportError],
  );

  const reopenWithEncoding = useCallback(
    async (next: MarkdownEncoding) => {
      try {
        const result = await executeCommand({
          type: markdownCommands.reopenWithEncoding,
          payload: { encoding: next },
        });
        requireValidResult(
          result,
          isMarkdownReopenResult,
          'Markdown Workbench 编码重开响应无效',
        );
        workingBufferRef.current = result.payload.diskSource;
        lineEndingRef.current = result.payload.lineEnding;
        setWorkingBuffer(result.payload.diskSource);
        setDiskSource(result.payload.diskSource);
        setEncoding(result.payload.encoding);
        setLineEnding(result.payload.lineEnding);
        setSavedLineEnding(result.payload.lineEnding);
        if (viewStateRef.current.viewMode === 'source') {
          setSourceEditorKey((current) => current + 1);
        } else {
          setWysiwygEditorKey((current) => current + 1);
        }
      } catch (error) {
        reportError(error, '无法使用所选编码重新打开 Markdown。');
        throw error;
      }
    },
    [executeCommand, reportError],
  );

  const conversationContributionId =
    `${markdownWorkbenchManifest.id}.document-question`;
  const applySourceContent = useCallback((content: string) => {
      const view = sourceEditorRef.current?.view;
      if (view) {
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: content,
          },
        });
      }
      workingBufferRef.current = content;
      setWorkingBuffer(content);
  }, []);

  const persistMarkdownSource = useCallback(
    async (content: string) => {
      const sourceState =
        viewStateRef.current.sourceViewState ?? {
          anchor: 0,
          head: 0,
          scrollTop: 0,
        };
      await syncSourceBuffer(content, sourceState);
      const result = await executeCommand({
        type: markdownCommands.save,
      });
      requireValidResult(
        result,
        isMarkdownSaveResult,
        'Markdown Workbench 保存响应无效',
      );
      setDiskSource(content);
      setSavedLineEnding(lineEndingRef.current);
      wysiwygEditedSinceMountRef.current = false;
    },
    [executeCommand, syncSourceBuffer],
  );

  const writeAnswerInSourceMode = useCallback(
    async (input: {
      readonly text: string;
      readonly context?: DocumentConversationContext;
    }) => {
      if (saving || recovery) {
        throw new Error(
          'Markdown 正在保存或等待恢复处理，请稍后再写回原文。',
        );
      }
      setSaving(true);
      try {
        await writeMarkdownAnswerToSource({
          content: workingBufferRef.current,
          context: input.context,
          text: input.text,
          lineEnding: lineEndingRef.current,
          applyContent: applySourceContent,
          persistContent: persistMarkdownSource,
        });
      } finally {
        setSaving(false);
      }
    },
    [applySourceContent, persistMarkdownSource, recovery, saving],
  );

  useEffect(() => {
    if (viewState.viewMode !== 'source') return;
    const pending = pendingAnswerInsertionRef.current;
    if (!pending) return;
    pendingAnswerInsertionRef.current = undefined;
    void writeAnswerInSourceMode({
      text: pending.text,
      context: pending.context,
    }).then(pending.resolve, pending.reject);
  }, [
    sourceEditorKey,
    viewState.viewMode,
    writeAnswerInSourceMode,
  ]);

  useEffect(() => () => {
    const pending = pendingAnswerInsertionRef.current;
    pendingAnswerInsertionRef.current = undefined;
    pending?.reject(
      new DOMException('Markdown Workbench 已关闭', 'AbortError'),
    );
  }, []);

  const returnAnswerToSource = useCallback(
    async (input: {
      readonly text: string;
      readonly question?: string;
      readonly context?: DocumentConversationContext;
    }) => {
      if (viewStateRef.current.viewMode !== 'source') {
        await new Promise<void>((resolve, reject) => {
          pendingAnswerInsertionRef.current = {
            ...(input.context ? { context: input.context } : {}),
            text: input.text,
            resolve,
            reject,
          };
          void switchMode('source').catch((error: unknown) => {
            const pending = pendingAnswerInsertionRef.current;
            pendingAnswerInsertionRef.current = undefined;
            pending?.reject(error);
          });
        });
        return;
      }
      await writeAnswerInSourceMode({
        text: input.text,
        context: input.context,
      });
    },
    [switchMode, writeAnswerInSourceMode],
  );

  const conversationHistoryStore = useMemo(
    () => createDocumentConversationHistoryStore(
      asset.projectId,
      asset.id,
      conversationContributionId,
    ),
    [asset.id, asset.projectId, conversationContributionId],
  );
  const conversationContribution = useMemo(
    () => createDocumentConversationContribution({
      projectId: asset.projectId,
      assetId: asset.id,
      workbenchId: markdownWorkbenchManifest.id,
      contributionId: conversationContributionId,
      historyStore: conversationHistoryStore,
      contextLabel: 'Markdown 选区',
      returnAnswerToSource,
      answerActionPresentation: MARKDOWN_ANSWER_ACTION_PRESENTATION,
    }),
    [
      asset.id,
      asset.projectId,
      conversationContributionId,
      conversationHistoryStore,
      returnAnswerToSource,
    ],
  );
  const conversationOwnerId =
    `${markdownWorkbenchManifest.id}:${bootstrap.sessionId}.conversation`;
  const conversationRuntime = useWorkbenchConversationContribution(
    conversationOwnerId,
    conversationContribution,
  );

  const scrollSelectionIntoView = useCallback(() => {
    const selection = window.getSelection();
    const range =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0)
        : undefined;
    if (range) {
      scrollRangeIntoView(range);
    }
  }, []);

  const revealTextFragmentInElement = useCallback(
    (element: HTMLElement, text: string) => {
      const fragment = Array.from(text)
        .slice(0, 12)
        .join('')
        .replace(/\s+/gu, ' ')
        .trim();
      if (
        fragment.length >= 2 &&
        selectTextInElement(element, fragment)
      ) {
        scrollSelectionIntoView();
      }
    },
    [scrollSelectionIntoView],
  );

  const revealMarkdownSelection = useCallback(
    (start: number, end: number) => {
      const source = workingBufferRef.current;
      const sourceLength = source.length;
      const clampedStart = Math.max(
        0,
        Math.min(start, sourceLength),
      );
      const clampedEnd = Math.max(
        clampedStart,
        Math.min(end, sourceLength),
      );

      if (viewStateRef.current.viewMode === 'source') {
        revealSelectionInCodeMirror(
          sourceEditorRef.current?.view,
          clampedStart,
          clampedEnd,
        );
        return;
      }

      const element = wysiwygAdapterRef.current?.getEditableElement();
      if (!element || clampedEnd <= clampedStart) {
        return;
      }

      const text = source.slice(clampedStart, clampedEnd).trim();
      if (!text) {
        return;
      }
      if (selectTextInElement(element, text)) {
        scrollSelectionIntoView();
        return;
      }
      revealTextFragmentInElement(element, text);
    },
    [revealTextFragmentInElement, scrollSelectionIntoView],
  );

  const revealMarkdownText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      if (viewStateRef.current.viewMode === 'wysiwyg') {
        const element = wysiwygAdapterRef.current?.getEditableElement();
        if (!element) {
          return;
        }
        if (selectTextInElement(element, trimmed)) {
          scrollSelectionIntoView();
          return;
        }
        revealTextFragmentInElement(element, trimmed);
        return;
      }

      const source = workingBufferRef.current;
      const index = source.indexOf(trimmed);
      if (index >= 0) {
        revealSelectionInCodeMirror(
          sourceEditorRef.current?.view,
          index,
          index + trimmed.length,
        );
      }
    },
    [revealTextFragmentInElement, scrollSelectionIntoView],
  );

  useEffect(() => {
    const reveal = (event: Event) => {
      const detail = (event as CustomEvent<RevealWorkbenchAnchorDetail>)
        .detail;
      if (
        detail.assetId !== asset.id ||
        detail.target.scope !== 'content'
      ) {
        return;
      }

      const target = detail.target;
      if (target.anchorType === MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE) {
        const selection = resolveTextSelectionFromTarget(target, [
          MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
        ]);
        if (selection) {
          revealMarkdownSelection(selection.start, selection.end);
        }
        return;
      }

      if (target.anchorType === MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE) {
        const payload = target.anchorPayload as {
          readonly exact?: unknown;
        };
        const text =
          typeof payload.exact === 'string' ? payload.exact : '';
        if (text.trim()) {
          revealMarkdownText(text);
        }
      }
    };

    window.addEventListener(WORKBENCH_REVEAL_ANCHOR_EVENT, reveal);
    return () => {
      window.removeEventListener(WORKBENCH_REVEAL_ANCHOR_EVENT, reveal);
    };
  }, [asset.id, revealMarkdownSelection, revealMarkdownText]);

  const rendererActions = useMemo(
    () =>
      createMarkdownRendererActions({
        disabled: saving || Boolean(recovery),
        encodingDisabled: dirty || Boolean(recovery),
        encoding,
        lineEnding,
        viewState,
        hasSelection: () =>
          activeEditorActionAdapter.getState().canCopy,
        onAiExplain: (text, anchor) => {
          conversationRuntime.open({
            ownerId: conversationOwnerId,
            context: createDocumentConversationContext({
              target: anchor,
              selectedText: text,
            }),
          });
        },
        onSetEncoding: reopenWithEncoding,
        onSetLineEnding: updateLineEnding,
        onSetViewState: updateViewState,
        onReveal,
      }),
    [
      dirty,
      encoding,
      lineEnding,
      activeEditorActionAdapter,
      asset.id,
      conversationOwnerId,
      conversationRuntime,
      onReveal,
      recovery,
      reopenWithEncoding,
      saving,
      updateLineEnding,
      updateViewState,
      viewState,
    ],
  );
  useWorkbenchContributions(
    markdownWorkbenchManifest.id,
    rendererActions,
  );

  if (!payload) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-rose-300">
          Markdown Workbench 数据无效
        </p>
      </div>
    );
  }

  return (
    <DocumentAiWorkbenchShell
      projectId={asset.projectId}
      assetId={asset.id}
      attachments={attachments ?? []}
      refreshAttachments={
        refreshAttachments ?? (async () => undefined)
      }
      onError={onError}
    >
      <div className="relative flex h-full min-h-0 flex-col bg-[#171c22]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.065] bg-[#1d2229] px-3">
        <div
          role="group"
          aria-label="Markdown 编辑模式"
          className="flex h-[28px] items-center rounded-lg border border-white/[0.08] bg-black/10 p-0.5"
        >
          {(['wysiwyg', 'source'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={Boolean(recovery) || saving}
              aria-pressed={viewState.viewMode === mode}
              onClick={() => void switchMode(mode).catch(() => undefined)}
              className={`rounded-md px-2.5 py-1 text-[10px] transition ${
                viewState.viewMode === mode
                  ? 'bg-white/[0.1] text-slate-100'
                  : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-300'
              } disabled:opacity-35`}
            >
              {mode === 'wysiwyg' ? '编辑' : '源码'}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!dirty || saving || Boolean(recovery)}
          onClick={() => void save()}
          className="ui-control h-[28px] rounded-lg border border-white/[0.09] px-3 text-[10px] font-medium text-slate-300 disabled:cursor-not-allowed disabled:opacity-35"
          title="保存 Markdown（⌘/Ctrl + S）"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {viewState.viewMode === 'source' ? (
          <div className="relative h-full min-h-0 overflow-hidden">
            <CodeMirror
              key={sourceEditorKey}
              ref={sourceEditorRef}
              aria-label="Markdown 源码编辑器"
              value={workingBuffer}
              height="100%"
              theme="none"
              extensions={configuredSourceExtensions}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                searchKeymap: true,
              }}
              selection={
                viewState.sourceViewState
                  ? {
                      anchor: Math.min(
                        viewState.sourceViewState.anchor,
                        workingBuffer.length,
                      ),
                      head: Math.min(
                        viewState.sourceViewState.head,
                        workingBuffer.length,
                      ),
                    }
                  : undefined
              }
              onCreateEditor={(view) => {
                requestAnimationFrame(() => {
                  view.scrollDOM.scrollTop =
                    viewStateRef.current.sourceViewState?.scrollTop ?? 0;
                });
              }}
              onChange={onSourceChange}
              onUpdate={onSourceUpdate}
              className="h-full min-h-0 overflow-hidden"
            />
          </div>
        ) : (
          <div
            aria-label="Markdown 可视化编辑器"
            className="relative h-full min-h-0 overflow-hidden bg-[#1b2027]"
          >
            <div
              key={wysiwygEditorKey}
              ref={wysiwygHostRef}
              className="learning-markdown-workbench h-full min-h-0 [&_.vditor]:h-full [&_.vditor]:border-0 [&_.vditor]:bg-[#1b2027] [&_.vditor-content]:min-h-0 [&_.vditor-content]:bg-[#1b2027] [&_.vditor-outline]:border-white/[0.08] [&_.vditor-outline]:bg-[#20262e] [&_.vditor-toolbar]:border-white/[0.08] [&_.vditor-toolbar]:bg-[#222831] [&_.vditor-wysiwyg]:bg-[#1b2027] [&_img[data-blocked-source='true']]:min-h-12 [&_img[data-blocked-source='true']]:rounded-lg [&_img[data-blocked-source='true']]:border [&_img[data-blocked-source='true']]:border-amber-300/20 [&_img[data-blocked-source='true']]:bg-amber-300/[0.05] [&_img[data-blocked-source='true']]:p-2 [&_img[data-blocked-source='true']]:text-amber-200/70"
            />

            {visualEditorState === 'loading' && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#1b2027] text-xs text-slate-500">
                正在启动 Markdown 可视化编辑器…
              </div>
            )}
            {visualEditorState === 'failed' && (
              <div className="absolute inset-0 grid place-items-center p-8 text-center">
                <div>
                  <p className="text-sm text-rose-300">
                    可视化编辑器加载失败
                  </p>
                  <div className="mt-4 flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setWysiwygEditorKey(
                          (current) => current + 1,
                        )
                      }
                      className="ui-primary-button rounded-full bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-900"
                    >
                      重试
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void switchMode('source').catch(() => undefined)
                      }
                      className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300"
                    >
                      使用源码模式
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center justify-between border-t border-white/[0.06] bg-[#1c2229] px-3 text-[10px] text-slate-500">
        <span>
          {dirty ? '未保存' : '已保存'} · {formatEncoding(encoding)} ·{' '}
          {lineEnding.toUpperCase()} ·{' '}
          {viewState.viewMode === 'wysiwyg' ? 'WYSIWYG' : '源码'}
        </span>
        <span>{viewState.viewMode === 'source' ? cursor : ''}</span>
      </div>

      {recovery &&
        createPortal(
          <MarkdownRecoveryDialog
            sourceChanged={recovery.sourceChanged}
            updatedTime={recovery.updatedTime}
            busy={recoveryBusy}
            onRestore={() => void restoreRecovery()}
            onDiscard={() => void discardRecovery()}
          />,
          document.body,
        )}
      <QuestionAnchorHost
        assetId={asset.id}
        ownerId={conversationOwnerId}
        historyStore={conversationHistoryStore}
        runtime={conversationRuntime}
      />
      </div>
    </DocumentAiWorkbenchShell>
  );
}

export const markdownRendererWorkbenchModule: RendererWorkbenchModule<
  typeof markdownWorkbenchManifest.id
> = {
  manifest: markdownWorkbenchManifest,
  View: MarkdownWorkbenchView,
};
