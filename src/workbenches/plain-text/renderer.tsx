import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  redo,
  redoDepth,
  selectAll,
  undo,
  undoDepth,
} from '@codemirror/commands';
import CodeMirror, {
  EditorView,
  type ReactCodeMirrorRef,
  type ViewUpdate,
} from '@uiw/react-codemirror';
import { openSearchPanel } from '@codemirror/search';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { userMessageFromError } from '../../shared/ipc-error';
import type { WorkbenchCommandResult } from '../../shared/workbench/protocol';
import {
  createPlainTextBufferCommand,
  createPlainTextViewStateCommand,
  isPlainTextBackupResult,
  isPlainTextLineEndingResult,
  isPlainTextReopenResult,
  isPlainTextSaveResult,
  isPlainTextViewOptions,
  isPlainTextWorkbenchPayload,
  plainTextCommands,
  plainTextWorkbenchManifest,
  type PlainTextEncoding,
  type PlainTextLineEnding,
  type PlainTextViewOptions,
  type PlainTextViewState,
} from './shared';
import { PlainTextWorkbenchMenu } from './workbench-menu';

type BackupStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'failed';
type ContextMenuState = { readonly x: number; readonly y: number } | null;

type ContextMenuSelectionState = {
  readonly hasSelection: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
};

const plainTextEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      color: '#dbe4f3',
      backgroundColor: '#171c22',
      fontSize: '14px',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily:
        '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      lineHeight: '1.72',
      scrollBehavior: 'smooth',
      scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(170, 180, 205, 0.75) rgba(20, 25, 32, 0.35)',
      overscrollBehavior: 'contain',
      scrollbarGutter: 'stable',
      paddingBottom: '16px',
    },
    '.cm-scroller::-webkit-scrollbar': {
      width: '10px',
    },
    '.cm-scroller::-webkit-scrollbar-track': {
      backgroundColor: 'rgba(20, 25, 32, 0.45)',
    },
    '.cm-scroller::-webkit-scrollbar-thumb': {
      backgroundColor: 'rgba(120, 135, 165, 0.45)',
      borderRadius: '9px',
      border: '2px solid rgba(20, 25, 32, 0.8)',
    },
    '.cm-scroller::-webkit-scrollbar-thumb:hover': {
      backgroundColor: 'rgba(149, 167, 199, 0.62)',
    },
    '.cm-content': {
      minHeight: '100%',
      padding: '18px 6px 40px',
      caretColor: '#c7d2fe',
    },
    '.cm-line': {
      padding: '0 16px',
    },
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
    '.cm-tooltip': {
      color: '#dbe4f3',
      backgroundColor: '#272e38',
      border: '1px solid rgba(255,255,255,0.1)',
    },
  },
  { dark: true },
);

function isMacPlatform(): boolean {
  return /Mac/i.test(navigator.platform);
}

function resolveContextMenuPosition(
  clientX: number,
  clientY: number,
  host: HTMLDivElement,
  menuWidth = 224,
  menuHeight = 286,
): { x: number; y: number } {
  const bounds = host.getBoundingClientRect();
  const nextX = Math.min(
    Math.max(0, clientX - bounds.left - 6),
    Math.max(8, bounds.width - menuWidth - 6),
  );
  const nextY = Math.min(
    Math.max(0, clientY - bounds.top - 4),
    Math.max(8, bounds.height - menuHeight - 4),
  );

  return { x: nextX, y: nextY };
}

function viewStateFromUpdate(update: ViewUpdate): PlainTextViewState {
  const selection = update.state.selection.main;

  return {
    anchor: selection.anchor,
    head: selection.head,
    scrollTop: Math.max(0, update.view.scrollDOM.scrollTop),
  };
}

function hasSelection(editor: EditorView | undefined): boolean {
  if (!editor) {
    return false;
  }

  return editor.state.selection.ranges.some((range) => !range.empty);
}

function selectedText(editor: EditorView | undefined): string {
  if (!editor) {
    return '';
  }

  return editor.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => editor.state.doc.sliceString(range.from, range.to))
    .join('\n');
}

function replaceSelectionText(
  editor: EditorView | undefined,
  replacement: string,
): boolean {
  if (!editor) {
    return false;
  }

  const nonEmptyRanges = editor.state.selection.ranges.filter(
    (range) => !range.empty,
  );
  if (nonEmptyRanges.length === 0) {
    return false;
  }

  editor.dispatch({
    changes: nonEmptyRanges.map((selectionRange) => ({
      from: selectionRange.from,
      to: selectionRange.to,
      insert: replacement,
    })),
  });

  return true;
}

function insertTextAtSelection(editor: EditorView | undefined, text: string): void {
  if (!editor) {
    return;
  }

  editor.dispatch({
    changes: editor.state.selection.ranges.map((selectionRange) => ({
      from: selectionRange.from,
      to: selectionRange.to,
      insert: text,
    })),
  });
}

function cursorLabel(update: ViewUpdate): string {
  const head = update.state.selection.main.head;
  const line = update.state.doc.lineAt(head);
  return `第 ${line.number} 行，第 ${head - line.from + 1} 列`;
}

function formatEncoding(encoding: string): string {
  return encoding.toUpperCase().replace('UTF-8', 'UTF-8');
}

function validateCommandResult(
  result: WorkbenchCommandResult,
  predicate: (value: WorkbenchCommandResult['payload']) => boolean,
): void {
  if (!predicate(result.payload)) {
    throw new Error('Plain Text Workbench 响应无效');
  }
}

function PlainTextRecoveryDialog({
  sourceChanged,
  updatedTime,
  busy,
  onRestore,
  onDiscard,
}: {
  readonly sourceChanged: boolean;
  readonly updatedTime: number;
  readonly busy: boolean;
  readonly onRestore: () => void;
  readonly onDiscard: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-[#11151a]/76 p-6 backdrop-blur-[3px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plain-text-recovery-title"
        className="w-full max-w-[430px] rounded-[18px] border border-white/[0.11] bg-[#262c35] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-400/12 text-base text-indigo-200">
            ↺
          </span>
          <div>
            <h3
              id="plain-text-recovery-title"
              className="text-sm font-semibold text-slate-100"
            >
              发现未保存的编辑内容
            </h3>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              上次编辑内容已于
              {' '}
              {new Date(updatedTime).toLocaleString()}
              {' '}
              自动备份。
            </p>
          </div>
        </div>
        {sourceChanged && (
          <p className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.07] px-3 py-2.5 text-xs leading-5 text-amber-100/80">
            原文件在备份之后发生过变化。恢复内容不会立即覆盖文件，只有点击保存时才会写入。
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

export function PlainTextWorkbenchView({
  bootstrap,
  headerActionsTarget,
  executeCommand,
  onError,
}: RendererWorkbenchViewProps) {
  const payload = isPlainTextWorkbenchPayload(bootstrap.payload)
    ? bootstrap.payload
    : undefined;
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const viewStateRef = useRef<PlainTextViewState>(
    payload?.viewState ?? { anchor: 0, head: 0, scrollTop: 0 },
  );
  const latestContentRef = useRef(payload?.content ?? '');
  const [content, setContent] = useState(payload?.content ?? '');
  const [savedContent, setSavedContent] = useState(payload?.content ?? '');
  const [lineEnding, setLineEnding] = useState(
    payload?.lineEnding ?? 'lf',
  );
  const [savedLineEnding, setSavedLineEnding] = useState(
    payload?.lineEnding ?? 'lf',
  );
  const [encoding, setEncoding] = useState<PlainTextEncoding>(
    payload?.encoding ?? 'utf-8',
  );
  const [viewOptions, setViewOptions] = useState<PlainTextViewOptions>(
    payload?.viewOptions ?? {
      wordWrap: true,
      lineNumbers: true,
    },
  );
  const [editorInstanceKey, setEditorInstanceKey] = useState(0);
  const [recovery, setRecovery] = useState(payload?.recovery);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backupStatus, setBackupStatus] =
    useState<BackupStatus>('idle');
  const [cursor, setCursor] = useState('第 1 行，第 1 列');
  const [contextMenuState, setContextMenuState] =
    useState<ContextMenuState>(null);
  const [contextMenuBusy, setContextMenuBusy] = useState(false);
  const [contextMenuSelectionState, setContextMenuSelectionState] =
    useState<ContextMenuSelectionState>({
      hasSelection: false,
      canUndo: false,
      canRedo: false,
    });
  const editorHostRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const dirty =
    content !== savedContent || lineEnding !== savedLineEnding;
  const extensions = useMemo(() => {
    const configured = [plainTextEditorTheme];

    if (viewOptions.wordWrap) {
      configured.push(EditorView.lineWrapping);
    }

    return configured;
  }, [viewOptions.wordWrap]);

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

  const currentBufferPayload = useCallback(
    () => ({
      content: latestContentRef.current,
      lineEnding,
      viewState: viewStateRef.current,
    }),
    [lineEnding],
  );

  const updateContextMenuSelectionState = useCallback(() => {
    const editor = editorRef.current?.view;
    const state = editor?.state;
    setContextMenuSelectionState({
      hasSelection: hasSelection(editor),
      canUndo: state !== undefined && undoDepth(state) > 0,
      canRedo: state !== undefined && redoDepth(state) > 0,
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenuState(null);
  }, []);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) {
        closeContextMenu();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };
    const closeOnScroll = () => {
      closeContextMenu();
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', closeOnScroll, { passive: true });
    window.addEventListener('resize', closeOnScroll);

    const editor = editorRef.current?.view;
    const scrollDom = editor?.scrollDOM;
    scrollDom?.addEventListener('scroll', closeOnScroll, { passive: true });

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', closeOnScroll);
      window.removeEventListener('resize', closeOnScroll);
      scrollDom?.removeEventListener('scroll', closeOnScroll);
    };
  }, [closeContextMenu, contextMenuState]);

  const clipboardCopyText = useCallback(async (text: string) => {
    if (!navigator.clipboard?.writeText) {
      throw new Error('当前环境不支持写入剪贴板');
    }

    await navigator.clipboard.writeText(text);
  }, []);

  const clipboardReadText = useCallback(async () => {
    if (!navigator.clipboard?.readText) {
      throw new Error('当前环境不支持读取剪贴板');
    }

    return navigator.clipboard.readText();
  }, []);

  const withContextMenuBusy = useCallback(
    async (callback: () => Promise<void> | void) => {
      setContextMenuBusy(true);
      try {
        await callback();
      } catch (error: unknown) {
        const message = userMessageFromError(
          error,
          '文本编辑器快捷操作失败，请重试。',
        );
        if (message) {
          console.error(message, error);
          onError(message);
        }
      } finally {
        setContextMenuBusy(false);
      }
    },
    [onError],
  );

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const editor = editorRef.current?.view;
      const host = editorHostRef.current;
      if (!editor || !host || recovery) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const position = resolveContextMenuPosition(
        event.clientX,
        event.clientY,
        host,
      );
      const clickedPosition = (
        editor as EditorView & {
          posAtCoords?: (position: {
            x: number;
            y: number;
          }) => number | null;
        }
      ).posAtCoords?.({
        x: event.clientX,
        y: event.clientY,
      });

      if (typeof clickedPosition === 'number') {
        const contains = editor.state.selection.ranges.some(
          (selectionRange) =>
            clickedPosition >= selectionRange.from &&
            clickedPosition <= selectionRange.to,
        );
        if (!contains) {
          editor.dispatch({
            selection: { anchor: clickedPosition, head: clickedPosition },
          });
        }
      }

      const viewState = editor.state;
      const hasCurrentSelection = hasSelection(editor);
      setContextMenuState(position);
      setContextMenuSelectionState({
        hasSelection: hasCurrentSelection,
        canUndo: undoDepth(viewState) > 0,
        canRedo: redoDepth(viewState) > 0,
      });
    },
    [recovery],
  );

  const onEditorWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const editor = editorRef.current?.view;
    if (!editor || recovery) {
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      return;
    }

    const scrollDOM = editor.scrollDOM;
    if (!scrollDOM) {
      return;
    }

    if (event.deltaY === 0 && event.deltaX === 0) {
      return;
    }

    event.preventDefault();

    const canScrollY = event.deltaY !== 0 && scrollDOM.scrollHeight > scrollDOM.clientHeight;
    const canScrollX = event.deltaX !== 0 && scrollDOM.scrollWidth > scrollDOM.clientWidth;
    if (!canScrollY && !canScrollX) {
      return;
    }

    scrollDOM.scrollBy({
      top: event.deltaY,
      left: canScrollX ? event.deltaX : 0,
      behavior: 'auto',
    });
  }, [recovery]);

  const onContextMenuUndo = useCallback(() => {
    void withContextMenuBusy(async () => {
      const editor = editorRef.current?.view;
      if (!editor) {
        return;
      }

      closeContextMenu();
      undo(editor);
      updateContextMenuSelectionState();
    });
  }, [closeContextMenu, updateContextMenuSelectionState, withContextMenuBusy]);

  const onContextMenuRedo = useCallback(() => {
    void withContextMenuBusy(async () => {
      const editor = editorRef.current?.view;
      if (!editor) {
        return;
      }

      closeContextMenu();
      redo(editor);
      updateContextMenuSelectionState();
    });
  }, [closeContextMenu, updateContextMenuSelectionState, withContextMenuBusy]);

  const onContextMenuCopy = useCallback(() => {
    void withContextMenuBusy(async () => {
      const editor = editorRef.current?.view;
      if (!editor) {
        return;
      }

      const text = selectedText(editor);
      if (!text) {
        return;
      }

      await clipboardCopyText(text);
      closeContextMenu();
    });
  }, [closeContextMenu, clipboardCopyText, withContextMenuBusy]);

  const onContextMenuCut = useCallback(() => {
    if (recovery) {
      return;
    }

    void withContextMenuBusy(async () => {
      const editor = editorRef.current?.view;
      if (!editor) {
        return;
      }

      const text = selectedText(editor);
      if (!text) {
        return;
      }

      await clipboardCopyText(text);
      replaceSelectionText(editor, '');
      updateContextMenuSelectionState();
      closeContextMenu();
    });
  }, [
    closeContextMenu,
    clipboardCopyText,
    updateContextMenuSelectionState,
    withContextMenuBusy,
    recovery,
  ]);

  const onContextMenuPaste = useCallback(() => {
    if (recovery) {
      return;
    }

    void withContextMenuBusy(async () => {
      const editor = editorRef.current?.view;
      if (!editor) {
        return;
      }

      const text = await clipboardReadText();
      insertTextAtSelection(editor, text);
      updateContextMenuSelectionState();
      closeContextMenu();
    });
  }, [
    closeContextMenu,
    clipboardReadText,
    updateContextMenuSelectionState,
    withContextMenuBusy,
    recovery,
  ]);

  const onContextMenuFind = useCallback(() => {
    void withContextMenuBusy(async () => {
      const editor = editorRef.current?.view;
      if (!editor) {
        return;
      }

      const panelOpened = openSearchPanel(editor);
      if (!panelOpened) {
        throw new Error('当前编辑器不支持搜索');
      }
      closeContextMenu();
    });
  }, [closeContextMenu, withContextMenuBusy]);

  const onContextMenuSelectAll = useCallback(() => {
    void withContextMenuBusy(() => {
      const editor = editorRef.current?.view;
      if (!editor) {
        return;
      }

      selectAll(editor);
      closeContextMenu();
      updateContextMenuSelectionState();
    });
  }, [closeContextMenu, updateContextMenuSelectionState, withContextMenuBusy]);

  const updateViewOptions = useCallback(
    async (nextViewOptions: PlainTextViewOptions) => {
      try {
        const result = await executeCommand({
          type: plainTextCommands.setViewOptions,
          payload: {
            wordWrap: nextViewOptions.wordWrap,
            lineNumbers: nextViewOptions.lineNumbers,
          },
        });

        if (!isPlainTextViewOptions(result.payload)) {
          throw new Error('Plain Text Workbench 显示选项响应无效');
        }

        setViewOptions({
          wordWrap: result.payload.wordWrap,
          lineNumbers: result.payload.lineNumbers,
        });
      } catch (error) {
        reportError(error, '无法更新文本编辑器显示选项。');
      }
    },
    [executeCommand, reportError],
  );

  const updateLineEnding = useCallback(
    async (nextLineEnding: PlainTextLineEnding) => {
      try {
        const result = await executeCommand({
          type: plainTextCommands.setLineEnding,
          payload: { lineEnding: nextLineEnding },
        });

        if (!isPlainTextLineEndingResult(result.payload)) {
          throw new Error('Plain Text Workbench 行尾序列响应无效');
        }

        setLineEnding(result.payload.lineEnding);
      } catch (error) {
        reportError(error, '无法更新文本文件的行尾序列。');
      }
    },
    [executeCommand, reportError],
  );

  const reopenWithEncoding = useCallback(
    async (nextEncoding: PlainTextEncoding) => {
      try {
        const result = await executeCommand({
          type: plainTextCommands.reopenWithEncoding,
          payload: { encoding: nextEncoding },
        });

        if (!isPlainTextReopenResult(result.payload)) {
          throw new Error('Plain Text Workbench 编码重开响应无效');
        }

        latestContentRef.current = result.payload.content;
        setContent(result.payload.content);
        setSavedContent(result.payload.content);
        setLineEnding(result.payload.lineEnding);
        setSavedLineEnding(result.payload.lineEnding);
        setEncoding(result.payload.encoding);
        setBackupStatus('idle');
        setEditorInstanceKey((current) => current + 1);
      } catch (error) {
        reportError(error, '无法使用所选编码重新打开文本文件。');
      }
    },
    [executeCommand, reportError],
  );

  const save = useCallback(async () => {
    if (!payload || saving || recovery) {
      return;
    }

    const buffer = currentBufferPayload();

    if (
      buffer.content === savedContent &&
      buffer.lineEnding === savedLineEnding
    ) {
      return;
    }

    setSaving(true);
    try {
      const result = await executeCommand(
        createPlainTextBufferCommand(plainTextCommands.save, buffer),
      );
      validateCommandResult(result, isPlainTextSaveResult);
      setSavedContent(buffer.content);
      setSavedLineEnding(buffer.lineEnding);
      setBackupStatus('idle');
    } catch (error) {
      reportError(error, '无法保存文本文件，请重试。');
    } finally {
      setSaving(false);
    }
  }, [
    currentBufferPayload,
    executeCommand,
    payload,
    recovery,
    reportError,
    savedContent,
    savedLineEnding,
    saving,
  ]);

  useEffect(() => {
    if (!payload || recovery || !dirty) {
      return;
    }

    setBackupStatus('pending');
    const timer = window.setTimeout(() => {
      setBackupStatus('saving');
      void executeCommand(
        createPlainTextBufferCommand(
          plainTextCommands.backup,
          currentBufferPayload(),
        ),
      )
        .then((result) => {
          validateCommandResult(result, isPlainTextBackupResult);
          setBackupStatus('saved');
        })
        .catch((error: unknown) => {
          setBackupStatus('failed');
          reportError(error, '无法备份未保存的文本内容。');
        });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [
    content,
    currentBufferPayload,
    dirty,
    executeCommand,
    payload,
    recovery,
    reportError,
  ]);

  useEffect(() => {
    if (!payload || recovery || dirty) {
      return;
    }

    const timer = window.setTimeout(() => {
      void executeCommand(
        createPlainTextViewStateCommand(viewStateRef.current),
      ).catch((error: unknown) => {
        reportError(error, '无法保存文本阅读位置。');
      });
    }, 900);

    return () => window.clearTimeout(timer);
  }, [cursor, dirty, executeCommand, payload, recovery, reportError]);

  if (!payload) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-rose-300">
          Plain Text Workbench 数据无效
        </p>
      </div>
    );
  }

  const restoreRecovery = () => {
    if (!recovery) {
      return;
    }

    const restoredContent = recovery.content;
    latestContentRef.current = restoredContent;
    setContent(restoredContent);
    setLineEnding(recovery.lineEnding);
    setRecovery(undefined);
    setBackupStatus('pending');
    void executeCommand(
      createPlainTextBufferCommand(plainTextCommands.syncBuffer, {
        content: restoredContent,
        lineEnding: recovery.lineEnding,
        viewState: viewStateRef.current,
      }),
    ).catch((error: unknown) => {
      reportError(error, '无法恢复未保存的文本内容。');
    });
  };

  const discardRecovery = async () => {
    setRecoveryBusy(true);
    try {
      await executeCommand({
        type: plainTextCommands.discardRecovery,
      });
      setRecovery(undefined);
      setLineEnding(payload.lineEnding);
      setBackupStatus('idle');
    } catch (error) {
      reportError(error, '无法丢弃恢复内容，请重试。');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const backupLabel = dirty
    ? {
        idle: '尚未备份',
        pending: '等待自动备份',
        saving: '正在备份…',
        saved: '已备份未保存内容',
        failed: '备份失败',
      }[backupStatus]
    : '已保存';

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-[#171c22]"
      onKeyDownCapture={(event) => {
        if (
          event.key.toLowerCase() === 's' &&
          (event.metaKey || event.ctrlKey)
        ) {
          event.preventDefault();
          void save();
        }
      }}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.065] bg-[#1d2229] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={[
              'size-1.5 rounded-full',
              dirty ? 'bg-amber-300' : 'bg-emerald-300/70',
            ].join(' ')}
          />
          <span className="text-[11px] text-slate-400">
            {dirty ? '未保存' : '已保存'}
          </span>
          <span className="h-3 w-px bg-white/[0.08]" />
          <span className="rounded-md bg-white/[0.045] px-1.5 py-0.5 text-[10px] text-slate-500">
            {formatEncoding(encoding)}
          </span>
          <span className="rounded-md bg-white/[0.045] px-1.5 py-0.5 text-[10px] text-slate-500">
            {lineEnding === 'crlf' ? 'CRLF' : 'LF'}
          </span>
        </div>
        <button
          type="button"
          disabled={!dirty || saving || Boolean(recovery)}
          onClick={() => void save()}
          className="ui-control rounded-lg border border-white/[0.09] px-3 py-1.5 text-[11px] font-medium text-slate-300 disabled:cursor-not-allowed disabled:opacity-35"
          title="保存（⌘/Ctrl + S）"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          ref={editorHostRef}
          className="relative h-full"
          onContextMenuCapture={onContextMenu}
          onWheelCapture={onEditorWheel}
        >
          <CodeMirror
            key={editorInstanceKey}
            ref={editorRef}
            value={content}
            height="100%"
            theme="none"
            extensions={extensions}
            basicSetup={{
              lineNumbers: viewOptions.lineNumbers,
              highlightActiveLineGutter: true,
              foldGutter: false,
              autocompletion: false,
              bracketMatching: false,
              closeBrackets: false,
              highlightActiveLine: true,
              highlightSelectionMatches: true,
              allowMultipleSelections: true,
              searchKeymap: true,
              foldKeymap: false,
              completionKeymap: false,
            }}
            readOnly={Boolean(recovery)}
            placeholder="空白文本"
            onCreateEditor={(view) => {
              const length = view.state.doc.length;
              const initial = viewStateRef.current;
              const anchor = Math.min(initial.anchor, length);
              const head = Math.min(initial.head, length);

              view.dispatch({ selection: { anchor, head } });
              updateContextMenuSelectionState();
              requestAnimationFrame(() => {
                view.scrollDOM.scrollTop = initial.scrollTop;
              });
            }}
            onChange={(value, update) => {
              const nextViewState = viewStateFromUpdate(update);
              latestContentRef.current = value;
              viewStateRef.current = nextViewState;
              setContent(value);
              setCursor(cursorLabel(update));
              updateContextMenuSelectionState();
              void executeCommand(
                createPlainTextBufferCommand(
                  plainTextCommands.syncBuffer,
                  {
                    content: value,
                    lineEnding,
                    viewState: nextViewState,
                  },
                ),
              ).catch((error: unknown) => {
                reportError(error, '无法同步文本编辑状态。');
              });
            }}
            onUpdate={(update) => {
              const nextViewState = viewStateFromUpdate(update);
              viewStateRef.current = nextViewState;
              setCursor(cursorLabel(update));
              updateContextMenuSelectionState();
            }}
          />
        </div>
        {contextMenuState && (
          <div
            ref={contextMenuRef}
            style={{ left: contextMenuState.x, top: contextMenuState.y }}
            className="absolute z-40 flex w-56 flex-col rounded-xl border border-white/[0.12] bg-[#292e36] p-1.5 text-[11px] text-slate-200 shadow-[0_18px_45px_rgba(0,0,0,0.42)]"
          >
            <button
              type="button"
              className="ui-menu-item flex w-full items-center justify-between rounded-lg px-3 py-2 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={
                contextMenuBusy || !contextMenuSelectionState.canUndo
              }
              onClick={onContextMenuUndo}
            >
              <span>撤销</span>
              <span className="text-slate-500">
                {`${isMacPlatform() ? '⌘' : 'Ctrl'} + Z`}
              </span>
            </button>
            <button
              type="button"
              className="ui-menu-item flex w-full items-center justify-between rounded-lg px-3 py-2 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={
                contextMenuBusy || !contextMenuSelectionState.canRedo
              }
              onClick={onContextMenuRedo}
            >
              <span>重做</span>
              <span className="text-slate-500">
                {`${isMacPlatform() ? '⌘' : 'Ctrl'} + Y`}
              </span>
            </button>

            <div className="my-1 h-px bg-white/[0.08]" />
            <button
              type="button"
              className="ui-menu-item flex w-full items-center justify-between rounded-lg px-3 py-2 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={
                contextMenuBusy ||
                !contextMenuSelectionState.hasSelection ||
                Boolean(recovery)
              }
              onClick={onContextMenuCut}
            >
              <span>剪切</span>
              <span className="text-slate-500">
                {`${isMacPlatform() ? '⌘' : 'Ctrl'} + X`}
              </span>
            </button>
            <button
              type="button"
              className="ui-menu-item flex w-full items-center justify-between rounded-lg px-3 py-2 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={
                contextMenuBusy || !contextMenuSelectionState.hasSelection
              }
              onClick={onContextMenuCopy}
            >
              <span>复制</span>
              <span className="text-slate-500">
                {`${isMacPlatform() ? '⌘' : 'Ctrl'} + C`}
              </span>
            </button>
            <button
              type="button"
              className="ui-menu-item flex w-full items-center justify-between rounded-lg px-3 py-2 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={contextMenuBusy || Boolean(recovery)}
              onClick={onContextMenuPaste}
            >
              <span>粘贴</span>
              <span className="text-slate-500">
                {`${isMacPlatform() ? '⌘' : 'Ctrl'} + V`}
              </span>
            </button>
            <button
              type="button"
              className="ui-menu-item flex w-full items-center justify-between rounded-lg px-3 py-2"
              disabled={contextMenuBusy}
              onClick={onContextMenuSelectAll}
            >
              <span>全选</span>
              <span className="text-slate-500">
                {`${isMacPlatform() ? '⌘' : 'Ctrl'} + A`}
              </span>
            </button>
            <button
              type="button"
              className="ui-menu-item flex w-full items-center justify-between rounded-lg px-3 py-2 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={contextMenuBusy}
              onClick={onContextMenuFind}
            >
              <span>查找</span>
              <span className="text-slate-500">
                {`${isMacPlatform() ? '⌘' : 'Ctrl'} + F`}
              </span>
            </button>

            <div className="my-1 h-px bg-white/[0.08]" />
            <p className="px-3 pt-1.5 pb-1 text-[10px] font-medium tracking-wide text-slate-500">
              AI 扩展（预留）
            </p>
            <button
              type="button"
              disabled
              className="ui-menu-item flex w-full items-center rounded-lg px-3 py-2 text-slate-500"
            >
              工作台 AI 动作（待接入）
            </button>
          </div>
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center justify-between border-t border-white/[0.055] bg-[#1b2027] px-3 text-[10px] text-slate-600">
        <span>{cursor}</span>
        <span className={backupStatus === 'failed' ? 'text-rose-300' : ''}>
          {content.length.toLocaleString()} 字符 · {backupLabel}
        </span>
      </div>

      {recovery && (
        <PlainTextRecoveryDialog
          sourceChanged={recovery.sourceChanged}
          updatedTime={recovery.updatedTime}
          busy={recoveryBusy}
          onRestore={restoreRecovery}
          onDiscard={() => void discardRecovery()}
        />
      )}
      {headerActionsTarget &&
        createPortal(
          <PlainTextWorkbenchMenu
            disabled={Boolean(recovery) || saving}
            encodingDisabled={dirty}
            encoding={encoding}
            lineEnding={lineEnding}
            viewOptions={viewOptions}
            onSetEncoding={reopenWithEncoding}
            onSetLineEnding={updateLineEnding}
            onSetViewOptions={updateViewOptions}
          />,
          headerActionsTarget,
        )}
    </div>
  );
}

export const plainTextRendererWorkbenchModule: RendererWorkbenchModule = {
  manifest: plainTextWorkbenchManifest,
  View: PlainTextWorkbenchView,
};
