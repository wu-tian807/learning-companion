import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  redo,
  redoDepth,
  selectAll,
  undo,
  undoDepth,
} from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { openSearchPanel } from '@codemirror/search';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import CodeMirror, {
  type ReactCodeMirrorRef,
} from '@uiw/react-codemirror';
import DiffMatchPatch from 'diff-match-patch';
import 'vditor/dist/index.css';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { userMessageFromError } from '../../shared/ipc-error';
import type { WorkbenchCommandResult } from '../../shared/workbench/protocol';
import {
  MarkdownEditorAdapter,
  type MarkdownEditorReadyState,
} from './markdown-editor-adapter';
import {
  cloneMarkdownWorkbenchViewState,
  createMarkdownSaveNormalizedCommand,
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
  type MarkdownBufferSyncResult,
  type MarkdownEditMode,
  type MarkdownEncoding,
  type MarkdownLineEnding,
  type MarkdownNormalizationState,
  type MarkdownSourceViewState,
  type MarkdownWorkbenchViewState,
} from './shared';
import {
  MarkdownSourceContextMenu,
  MarkdownWorkbenchMenu,
} from './workbench-menu';

type VisualEditorState =
  | 'loading'
  | 'safe'
  | 'requires-opt-in'
  | 'enabled-after-opt-in'
  | 'failed';

type SourceContextMenuState =
  | {
      readonly x: number;
      readonly y: number;
      readonly hasSelection: boolean;
      readonly canUndo: boolean;
      readonly canRedo: boolean;
    }
  | undefined;

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

function selectedSourceText(editor: EditorView | undefined): string {
  if (!editor) {
    return '';
  }

  return editor.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => editor.state.doc.sliceString(range.from, range.to))
    .join('\n');
}

function replaceSourceSelection(
  editor: EditorView | undefined,
  replacement: string,
  requireSelection: boolean,
): boolean {
  if (!editor) {
    return false;
  }

  const ranges = requireSelection
    ? editor.state.selection.ranges.filter((range) => !range.empty)
    : editor.state.selection.ranges;

  if (ranges.length === 0) {
    return false;
  }

  editor.dispatch({
    changes: ranges.map((range) => ({
      from: range.from,
      to: range.to,
      insert: replacement,
    })),
  });
  return true;
}

function resolveSourceContextMenuPosition(
  event: MouseEvent,
  host: HTMLElement,
): { x: number; y: number } {
  const bounds = host.getBoundingClientRect();
  const menuWidth = 224;
  const menuHeight = 308;

  return {
    x: Math.min(
      Math.max(8, event.clientX - bounds.left),
      Math.max(8, bounds.width - menuWidth - 8),
    ),
    y: Math.min(
      Math.max(8, event.clientY - bounds.top),
      Math.max(8, bounds.height - menuHeight - 8),
    ),
  };
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
  readonly normalizationPending: boolean;
  readonly updatedTime: number;
  readonly busy: boolean;
  readonly onRestore: () => void;
  readonly onDiscard: () => void;
}

function MarkdownRecoveryDialog({
  sourceChanged,
  normalizationPending,
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
        {normalizationPending && (
          <p className="mt-3 rounded-xl border border-indigo-300/15 bg-indigo-300/[0.06] px-3 py-2.5 text-xs leading-5 text-indigo-100/75">
            这份恢复内容来自可视化编辑，保存前仍需要检查源码规范化差异。
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

interface MarkdownNormalizationDialogProps {
  readonly diskSource: string;
  readonly workingBuffer: string;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onInspectSource: () => void;
  readonly onConfirm: () => void;
}

function MarkdownNormalizationDialog({
  diskSource,
  workingBuffer,
  saving,
  onCancel,
  onInspectSource,
  onConfirm,
}: MarkdownNormalizationDialogProps) {
  const diffs = useMemo(() => {
    const differ = new DiffMatchPatch();
    differ.Diff_Timeout = 1.5;
    const result = differ.diff_main(diskSource, workingBuffer, true);
    differ.diff_cleanupSemantic(result);
    return result;
  }, [diskSource, workingBuffer]);

  return (
    <div className="fixed inset-0 z-[85] grid place-items-center bg-slate-950/75 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="markdown-normalization-title"
        className="flex max-h-[82vh] w-full max-w-3xl flex-col rounded-2xl border border-white/[0.12] bg-[#242a32] shadow-[0_28px_90px_rgba(0,0,0,0.6)]"
      >
        <div className="border-b border-white/[0.08] px-5 py-4">
          <h2
            id="markdown-normalization-title"
            className="text-base font-semibold text-slate-100"
          >
            检查 Markdown 源码变化
          </h2>
          <p className="mt-1.5 text-xs leading-5 text-slate-400">
            可视化编辑器会重新序列化整份文档。红色为磁盘源码中将被删除的内容，绿色为准备写入的内容。
          </p>
        </div>
        <div
          aria-label="Markdown 源码差异"
          className="min-h-0 flex-1 overflow-auto bg-[#171c22] p-5 font-mono text-xs leading-5 whitespace-pre-wrap"
        >
          {diffs.map(([operation, text], index) => (
            <span
              key={`${operation}:${index}`}
              className={
                operation === DiffMatchPatch.DIFF_INSERT
                  ? 'bg-emerald-400/15 text-emerald-100'
                  : operation === DiffMatchPatch.DIFF_DELETE
                    ? 'bg-rose-400/15 text-rose-100 line-through decoration-rose-300/60'
                    : 'text-slate-400'
              }
            >
              {text}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-white/[0.08] px-5 py-4">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="ui-control rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300 disabled:opacity-45"
          >
            返回编辑
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onInspectSource}
            className="ui-control rounded-full border border-indigo-300/20 px-4 py-2 text-xs text-indigo-100 disabled:opacity-45"
          >
            切到源码检查
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onConfirm}
            className="ui-primary-button rounded-full bg-slate-50 px-5 py-2 text-xs font-semibold text-slate-900 disabled:opacity-45"
          >
            {saving ? '正在保存…' : '接受变化并保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MarkdownWorkbenchView(props: RendererWorkbenchViewProps) {
  const {
    bootstrap,
    headerActionsTarget,
    executeCommand,
    onReveal,
    onOpenExternal,
    onError,
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
  const sourceEditorHostRef = useRef<HTMLDivElement>(null);
  const wysiwygHostRef = useRef<HTMLDivElement>(null);
  const wysiwygAdapterRef = useRef<MarkdownEditorAdapter | undefined>(
    undefined,
  );
  const workingBufferRef = useRef(payload?.diskSource ?? '');
  const lineEndingRef = useRef<MarkdownLineEnding>(
    payload?.lineEnding ?? 'lf',
  );
  const viewStateRef = useRef<MarkdownWorkbenchViewState>(
    cloneMarkdownWorkbenchViewState(initialViewState),
  );
  const wysiwygEditedSinceMountRef = useRef(false);
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
  const [normalizationState, setNormalizationState] =
    useState<MarkdownNormalizationState>('clean');
  const [visualEditorState, setVisualEditorState] =
    useState<VisualEditorState>('loading');
  const [recovery, setRecovery] = useState(payload?.recovery);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [normalizationDialogOpen, setNormalizationDialogOpen] =
    useState(false);
  const [sourceEditorKey, setSourceEditorKey] = useState(0);
  const [wysiwygEditorKey, setWysiwygEditorKey] = useState(0);
  const [cursor, setCursor] = useState('第 1 行，第 1 列');
  const [sourceContextMenu, setSourceContextMenu] =
    useState<SourceContextMenuState>();
  const [sourceContextMenuBusy, setSourceContextMenuBusy] =
    useState(false);
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

  const openSourceContextMenu = useCallback(
    (event: MouseEvent, editor: EditorView) => {
      const host = sourceEditorHostRef.current;

      if (!host || recovery) {
        return;
      }

      event.preventDefault();
      const clickedPosition = editor.posAtCoords({
        x: event.clientX,
        y: event.clientY,
      });

      if (clickedPosition !== null) {
        const clickedInsideSelection = editor.state.selection.ranges.some(
          (range) =>
            !range.empty &&
            clickedPosition >= range.from &&
            clickedPosition <= range.to,
        );

        if (!clickedInsideSelection) {
          editor.dispatch({
            selection: {
              anchor: clickedPosition,
              head: clickedPosition,
            },
          });
        }
      }

      const position = resolveSourceContextMenuPosition(event, host);
      setSourceContextMenu({
        ...position,
        hasSelection: editor.state.selection.ranges.some(
          (range) => !range.empty,
        ),
        canUndo: undoDepth(editor.state) > 0,
        canRedo: redoDepth(editor.state) > 0,
      });
    },
    [recovery],
  );

  const sourceContextMenuExtension = useMemo(
    () =>
      EditorView.domEventHandlers({
        contextmenu: (event, editor) => {
          openSourceContextMenu(event as MouseEvent, editor);
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

      setNormalizationState(result.payload.normalizationState);
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
    const abortController = new AbortController();
    setVisualEditorState('loading');
    wysiwygEditedSinceMountRef.current = false;
    const host = wysiwygHostRef.current;

    void MarkdownEditorAdapter.create({
      host,
      initialValue: workingBufferRef.current,
      initialScrollTop: viewStateRef.current.wysiwygScrollTop,
      outlineVisible: viewStateRef.current.outlineVisible,
      onReady: ({ roundTripSafe }: MarkdownEditorReadyState) => {
        if (!active) {
          return;
        }

        setVisualEditorState(
          roundTripSafe ? 'safe' : 'requires-opt-in',
        );
      },
      onInput: (value) => {
        if (!active) {
          return;
        }

        const adapter = wysiwygAdapterRef.current;
        const scrollTop = adapter?.getScrollTop() ?? 0;
        workingBufferRef.current = value;
        wysiwygEditedSinceMountRef.current = true;
        setWorkingBuffer(value);
        setNormalizationState('requires-confirmation');
        void syncWysiwygBuffer(value, scrollTop).catch((error) => {
          reportError(error, '无法同步 Markdown 可视化编辑内容。');
        });
      },
      onScroll: (scrollTop) => {
        if (!active) {
          return;
        }

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
        if (!active) {
          adapter.destroy();
          return;
        }

        wysiwygAdapterRef.current = adapter;
      })
      .catch((error) => {
        if (
          !active ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }

        setVisualEditorState('failed');
        reportError(error, '无法启动 Markdown 可视化编辑器。');
      });

    return () => {
      active = false;
      abortController.abort();
      const adapter = wysiwygAdapterRef.current;
      wysiwygAdapterRef.current = undefined;
      adapter?.destroy();
      host.replaceChildren();
    };
  }, [
    onOpenExternal,
    payload,
    recovery,
    reportError,
    scheduleViewStateSave,
    syncWysiwygBuffer,
    viewState.viewMode,
    wysiwygEditorKey,
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
        applyViewState(next);
        await persistViewState(next);

        if (mode === 'source') {
          setSourceEditorKey((current) => current + 1);
        } else {
          setWysiwygEditorKey((current) => current + 1);
        }
      } catch (error) {
        reportError(error, '无法切换 Markdown 编辑模式。');
      }
    },
    [
      applyViewState,
      persistViewState,
      recovery,
      reportError,
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
      normalizationState,
    };
  }, [
    dirty,
    normalizationState,
    syncSourceBuffer,
    syncWysiwygBuffer,
  ]);

  const save = useCallback(async () => {
    if (!dirty || saving || recovery) {
      return;
    }

    setSaving(true);
    try {
      const syncResult = await flushCurrentBuffer();

      if (
        syncResult.normalizationState === 'requires-confirmation'
      ) {
        setNormalizationDialogOpen(true);
        return;
      }

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
      setNormalizationState('clean');
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

  const saveNormalized = useCallback(async () => {
    setSaving(true);
    try {
      await flushCurrentBuffer();
      const result = await executeCommand(
        createMarkdownSaveNormalizedCommand(),
      );
      requireValidResult(
        result,
        isMarkdownSaveResult,
        'Markdown Workbench 规范化保存响应无效',
      );
      setDiskSource(workingBufferRef.current);
      setSavedLineEnding(lineEndingRef.current);
      setNormalizationState('clean');
      setNormalizationDialogOpen(false);
      wysiwygEditedSinceMountRef.current = false;
    } catch (error) {
      reportError(error, '无法保存 Markdown 文件。');
    } finally {
      setSaving(false);
    }
  }, [executeCommand, flushCurrentBuffer, reportError]);

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
      if (update.docChanged) {
        return;
      }

      if (update.viewportChanged || update.geometryChanged) {
        setSourceContextMenu(undefined);
      }
      const sourceState = sourceViewStateFromUpdate(update);
      setCursor(cursorLabel(update));
      scheduleViewStateSave({
        ...viewStateRef.current,
        viewMode: 'source',
        sourceViewState: sourceState,
      });
    },
    [scheduleViewStateSave],
  );

  const runSourceContextMenuAction = useCallback(
    async (operation: (editor: EditorView) => Promise<void> | void) => {
      const editor = sourceEditorRef.current?.view;

      if (!editor) {
        return;
      }

      setSourceContextMenuBusy(true);
      try {
        await operation(editor);
        setSourceContextMenu(undefined);
      } catch (error) {
        reportError(error, 'Markdown 源码编辑操作失败。');
      } finally {
        setSourceContextMenuBusy(false);
      }
    },
    [reportError],
  );

  const copySourceSelection = useCallback(
    async (editor: EditorView) => {
      const text = selectedSourceText(editor);

      if (text) {
        await navigator.clipboard.writeText(text);
      }
    },
    [],
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
      setNormalizationState(
        recovery.normalizationPending
          ? 'requires-confirmation'
          : 'clean',
      );

      if (recovery.normalizationPending) {
        await syncWysiwygBuffer(
          recovery.content,
          viewStateRef.current.wysiwygScrollTop,
        );
      } else if (recovery.editedFrom === 'source') {
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
        setNormalizationState('clean');
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

  const enableVisualEditing = useCallback(() => {
    wysiwygAdapterRef.current?.enableEditing();
    setVisualEditorState('enabled-after-opt-in');
  }, []);

  if (!payload) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-rose-300">
          Markdown Workbench 数据无效
        </p>
      </div>
    );
  }

  const headerActions = headerActionsTarget
    ? createPortal(
        <>
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
                onClick={() => void switchMode(mode)}
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
            {saving
              ? '保存中…'
              : normalizationState === 'requires-confirmation' && dirty
                ? '检查并保存'
                : '保存'}
          </button>
          <MarkdownWorkbenchMenu
            disabled={saving || Boolean(recovery)}
            encodingDisabled={dirty || Boolean(recovery)}
            encoding={encoding}
            lineEnding={lineEnding}
            viewState={viewState}
            normalizationPending={
              normalizationState === 'requires-confirmation' && dirty
            }
            onSetEncoding={reopenWithEncoding}
            onSetLineEnding={updateLineEnding}
            onSetViewState={updateViewState}
            onReviewNormalization={() =>
              setNormalizationDialogOpen(true)
            }
            onReveal={onReveal}
          />
        </>,
        headerActionsTarget,
      )
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#171c22]">
      {headerActions}

      <div className="relative min-h-0 flex-1">
        {viewState.viewMode === 'source' ? (
          <div
            ref={sourceEditorHostRef}
            className="relative h-full min-h-0 overflow-hidden"
          >
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
            {sourceContextMenu && (
              <MarkdownSourceContextMenu
                {...sourceContextMenu}
                busy={sourceContextMenuBusy}
                onClose={() => setSourceContextMenu(undefined)}
                onUndo={() =>
                  void runSourceContextMenuAction((editor) => {
                    undo(editor);
                  })
                }
                onRedo={() =>
                  void runSourceContextMenuAction((editor) => {
                    redo(editor);
                  })
                }
                onCut={() =>
                  void runSourceContextMenuAction(async (editor) => {
                    await copySourceSelection(editor);
                    replaceSourceSelection(editor, '', true);
                  })
                }
                onCopy={() =>
                  void runSourceContextMenuAction(copySourceSelection)
                }
                onPaste={() =>
                  void runSourceContextMenuAction(async (editor) => {
                    const text = await navigator.clipboard.readText();
                    replaceSourceSelection(editor, text, false);
                  })
                }
                onFind={() =>
                  void runSourceContextMenuAction((editor) => {
                    openSearchPanel(editor);
                  })
                }
                onSelectAll={() =>
                  void runSourceContextMenuAction((editor) => {
                    selectAll(editor);
                  })
                }
              />
            )}
          </div>
        ) : (
          <div
            aria-label="Markdown 可视化编辑器"
            className="relative h-full min-h-0 overflow-hidden bg-[#1b2027]"
          >
            <div
              key={wysiwygEditorKey}
              ref={wysiwygHostRef}
              className="h-full min-h-0 [&_.vditor]:h-full [&_.vditor]:border-0 [&_.vditor]:bg-[#1b2027] [&_.vditor-content]:min-h-0 [&_.vditor-content]:bg-[#1b2027] [&_.vditor-outline]:border-white/[0.08] [&_.vditor-outline]:bg-[#20262e] [&_.vditor-toolbar]:border-white/[0.08] [&_.vditor-toolbar]:bg-[#222831] [&_.vditor-wysiwyg]:bg-[#1b2027] [&_.vditor-wysiwyg]:text-slate-200 [&_img[data-blocked-source='true']]:min-h-12 [&_img[data-blocked-source='true']]:rounded-lg [&_img[data-blocked-source='true']]:border [&_img[data-blocked-source='true']]:border-amber-300/20 [&_img[data-blocked-source='true']]:bg-amber-300/[0.05] [&_img[data-blocked-source='true']]:p-2 [&_img[data-blocked-source='true']]:text-amber-200/70"
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
                  <button
                    type="button"
                    onClick={() => void switchMode('source')}
                    className="ui-control mt-4 rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300"
                  >
                    使用源码模式
                  </button>
                </div>
              </div>
            )}
            {visualEditorState === 'requires-opt-in' && (
              <div className="absolute right-4 bottom-4 left-4 z-20 flex items-center justify-between gap-4 rounded-xl border border-amber-300/15 bg-[#2d2c27]/95 px-4 py-3 shadow-xl backdrop-blur">
                <p className="text-xs leading-5 text-amber-100/80">
                  这份源码无法无损往返可视化编辑器。当前保持只读；启用编辑后，保存前必须检查源码差异。
                </p>
                <button
                  type="button"
                  onClick={enableVisualEditing}
                  className="ui-control shrink-0 rounded-full border border-amber-200/20 px-4 py-2 text-xs text-amber-50"
                >
                  以可视化模式编辑
                </button>
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
        <span
          className={
            normalizationState === 'requires-confirmation' && dirty
              ? 'text-amber-300/75'
              : undefined
          }
        >
          {normalizationState === 'requires-confirmation' && dirty
            ? '保存前需要检查源码规范化'
            : viewState.viewMode === 'source'
              ? cursor
              : visualEditorState === 'enabled-after-opt-in'
                ? '已启用可视化编辑'
                : ''}
        </span>
      </div>

      {recovery &&
        createPortal(
          <MarkdownRecoveryDialog
            sourceChanged={recovery.sourceChanged}
            normalizationPending={recovery.normalizationPending}
            updatedTime={recovery.updatedTime}
            busy={recoveryBusy}
            onRestore={() => void restoreRecovery()}
            onDiscard={() => void discardRecovery()}
          />,
          document.body,
        )}
      {normalizationDialogOpen &&
        createPortal(
          <MarkdownNormalizationDialog
            diskSource={diskSource}
            workingBuffer={workingBuffer}
            saving={saving}
            onCancel={() => setNormalizationDialogOpen(false)}
            onInspectSource={() => {
              setNormalizationDialogOpen(false);
              void switchMode('source');
            }}
            onConfirm={() => void saveNormalized()}
          />,
          document.body,
        )}
    </div>
  );
}

export const markdownRendererWorkbenchModule: RendererWorkbenchModule = {
  manifest: markdownWorkbenchManifest,
  View: MarkdownWorkbenchView,
};
