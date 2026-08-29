import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createEditorActionPreset } from '../../renderer/workbench/actions/editor-action-preset';
import { CodeMirrorEditorActionAdapter } from '../../renderer/workbench/editor/codemirror-action-adapter';
import CodeMirror, {
  EditorView,
  type ReactCodeMirrorRef,
  type ViewUpdate,
} from '@uiw/react-codemirror';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { useWorkbenchConversationContribution } from '../../renderer/conversation/workbench-conversation-context';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
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
  buildPlainTextAnswerBlock,
  insertAnswerBlockAtSelection,
} from '../document-ai/answer-insertion';
import { userMessageFromError } from '../../shared/ipc-error';
import type { WorkbenchCommandResult } from '../../shared/workbench/protocol';
import { createTextRangeTarget } from '../../shared/workbench/text-range-anchor';
import {
  createPlainTextBufferCommand,
  createPlainTextViewStateCommand,
  DEFAULT_PLAIN_TEXT_VIEW_OPTIONS,
  isPlainTextBackupResult,
  isPlainTextLineEndingResult,
  isPlainTextReopenResult,
  isPlainTextSaveResult,
  isPlainTextViewOptions,
  isPlainTextWorkbenchPayload,
  plainTextCommands,
  plainTextWorkbenchManifest,
  PLAIN_TEXT_RANGE_ANCHOR_TYPE,
  type PlainTextEncoding,
  type PlainTextLineEnding,
  type PlainTextViewOptions,
  type PlainTextViewState,
} from './shared';
import { createPlainTextRendererActions } from './renderer-actions';
import { PlainTextReadActionAdapter } from './read-action-adapter';

type BackupStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'failed';

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

function viewStateFromUpdate(update: ViewUpdate): PlainTextViewState {
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
  asset,
  executeCommand,
  onInteractionChange,
  onError,
  attachments,
  refreshAttachments,
}: RendererWorkbenchViewProps) {
  const runtime = useWorkbenchRuntime();
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
      wordWrap: DEFAULT_PLAIN_TEXT_VIEW_OPTIONS.wordWrap,
      lineNumbers: DEFAULT_PLAIN_TEXT_VIEW_OPTIONS.lineNumbers,
      readMode: DEFAULT_PLAIN_TEXT_VIEW_OPTIONS.readMode,
    },
  );
  const [editorInstanceKey, setEditorInstanceKey] = useState(0);
  const [recovery, setRecovery] = useState(payload?.recovery);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backupStatus, setBackupStatus] =
    useState<BackupStatus>('idle');
  const [cursor, setCursor] = useState('第 1 行，第 1 列');
  const [readScrollTop, setReadScrollTop] = useState(
    payload?.viewState?.scrollTop ?? 0,
  );
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

  const editorActionAdapter = useMemo(
    () =>
      new CodeMirrorEditorActionAdapter({
        getView: () => editorRef.current?.view,
        isEditable: () => !recovery,
        createTarget: ({ source, ranges }) =>
          createTextRangeTarget(
            PLAIN_TEXT_RANGE_ANCHOR_TYPE,
            source,
            ranges.map((range) => ({
              start: range.from,
              end: range.to,
            })),
          ),
      }),
    [recovery],
  );
  const readHostRef = useRef<HTMLDivElement>(null);
  const readContentRef = useRef<HTMLDivElement>(null);
  const readActionAdapter = useMemo(
    () =>
      new PlainTextReadActionAdapter({
        getScrollContainer: () => readHostRef.current,
        getContentElement: () => readContentRef.current,
        getSource: () => latestContentRef.current,
      }),
    [],
  );
  const activeEditorActionAdapter =
    viewOptions.readMode
      ? readActionAdapter
      : editorActionAdapter;
  const editorActions = useMemo(
    () => createEditorActionPreset(activeEditorActionAdapter),
    [activeEditorActionAdapter],
  );
  useWorkbenchContributions(
    `${plainTextWorkbenchManifest.id}.editor`,
    editorActions,
  );

  const onContextMenu = useCallback(
    (event: MouseEvent) => {
      if (recovery) {
        return;
      }

      event.preventDefault();
      const capture = editorActionAdapter.captureContextMenu(
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
      editorActionAdapter,
      recovery,
      runtime,
    ],
  );

  const onReadContextMenu = useCallback(
    (event: MouseEvent) => {
      if (recovery) {
        return;
      }

      event.preventDefault();
      const capture = readActionAdapter.captureContextMenu(
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
      readActionAdapter,
      recovery,
      runtime,
    ],
  );

  const contextMenuExtension = useMemo(
    () =>
      EditorView.domEventHandlers({
        contextmenu: (event) => {
          if (recovery) {
            return false;
          }

          onContextMenu(event as MouseEvent);
          return true;
        },
      }),
    [onContextMenu, recovery],
  );
  const editorExtensions = useMemo(
    () => [...extensions, contextMenuExtension],
    [contextMenuExtension, extensions],
  );

  const updateViewOptions = useCallback(
    async (nextViewOptions: PlainTextViewOptions) => {
      try {
        const result = await executeCommand({
          type: plainTextCommands.setViewOptions,
          payload: {
            wordWrap: nextViewOptions.wordWrap,
            lineNumbers: nextViewOptions.lineNumbers,
            readMode: nextViewOptions.readMode,
          },
        });

        if (!isPlainTextViewOptions(result.payload)) {
          throw new Error('Plain Text Workbench 显示选项响应无效');
        }

        setViewOptions({
          wordWrap: result.payload.wordWrap,
          lineNumbers: result.payload.lineNumbers,
          readMode: result.payload.readMode,
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
  }, [
    cursor,
    dirty,
    executeCommand,
    payload,
    readScrollTop,
    recovery,
    reportError,
  ]);

  const conversationContributionId =
    `${plainTextWorkbenchManifest.id}.document-question`;
  const returnAnswerToSource = useCallback(
    async (input: {
      readonly answer: string;
      readonly question?: string;
      readonly context?: DocumentConversationContext;
    }) => {
      const content = latestContentRef.current;
      const block = buildPlainTextAnswerBlock(input.answer, lineEnding);
      const inserted = insertAnswerBlockAtSelection({
        content,
        context: input.context,
        block,
      });
      if (inserted === undefined) {
        throw new Error('无法在原文中定位选中位置，请重新选择内容后提问。');
      }
      latestContentRef.current = inserted;
      setContent(inserted);
      await executeCommand(
        createPlainTextBufferCommand(plainTextCommands.syncBuffer, {
          content: inserted,
          lineEnding,
          viewState: viewStateRef.current,
        }),
      );
      await save();
    },
    [executeCommand, lineEnding, save],
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
      workbenchId: plainTextWorkbenchManifest.id,
      contributionId: conversationContributionId,
      historyStore: conversationHistoryStore,
      contextLabel: '文本选区',
      allowAnswerAttachments: true,
      returnAnswerToSource,
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
    `${plainTextWorkbenchManifest.id}:${bootstrap.sessionId}.conversation`;
  const conversationRuntime = useWorkbenchConversationContribution(
    conversationOwnerId,
    conversationContribution,
  );

  const rendererActions = useMemo(
    () =>
      createPlainTextRendererActions({
        disabled: Boolean(recovery) || saving,
        encodingDisabled: dirty,
        encoding,
        lineEnding,
        viewOptions,
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
        onSetViewOptions: updateViewOptions,
      }),
    [
      dirty,
      encoding,
      lineEnding,
      recovery,
      reopenWithEncoding,
      saving,
      activeEditorActionAdapter,
      asset.id,
      conversationOwnerId,
      conversationRuntime,
      updateLineEnding,
      updateViewOptions,
      viewOptions,
    ],
  );
  useWorkbenchContributions(
    plainTextWorkbenchManifest.id,
    rendererActions,
  );

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

  const switchMode = async (readMode: boolean) => {
    if (viewOptions.readMode === readMode || recovery) {
      return;
    }

    runtime.closeContextMenu();
    onInteractionChange({ inputs: [] });
    await updateViewOptions({
      ...viewOptions,
      readMode,
    });
  };

  useEffect(() => {
    if (!viewOptions.readMode || recovery) {
      return;
    }

    const element = readHostRef.current;

    if (!element) {
      return;
    }

    element.scrollTop = viewStateRef.current.scrollTop;

    const publishSelection = () => {
      onInteractionChange(
        readActionAdapter.captureInteraction(),
      );
    };
    const document = element.ownerDocument;

    document.addEventListener('selectionchange', publishSelection);
    return () => {
      document.removeEventListener(
        'selectionchange',
        publishSelection,
      );
    };
  }, [
    onInteractionChange,
    readActionAdapter,
    recovery,
    viewOptions.readMode,
  ]);

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
        <div className="flex shrink-0 items-center gap-2">
          <div
            role="group"
            aria-label="纯文本视图模式"
            className="flex h-[28px] items-center rounded-lg border border-white/[0.08] bg-black/10 p-0.5"
          >
            {(
              [
                ['edit', '编辑'],
                ['read', '阅读'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                disabled={Boolean(recovery) || saving}
                aria-pressed={viewOptions.readMode === (mode === 'read')}
                onClick={() => void switchMode(mode === 'read')}
                className={`rounded-md px-2.5 py-1 text-[10px] transition ${
                  viewOptions.readMode === (mode === 'read')
                    ? 'bg-white/[0.1] text-slate-100'
                    : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-300'
                } disabled:opacity-35`}
              >
                {label}
              </button>
            ))}
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
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {viewOptions.readMode ? (
          <div className="relative h-full min-h-0 overflow-hidden bg-[#171c22]">
            <div
              ref={readHostRef}
              aria-label="纯文本阅读视图"
              className="h-full min-h-0 overflow-y-auto px-6 py-9"
              onContextMenu={(event) =>
                onReadContextMenu(event.nativeEvent)}
              onScroll={(event) => {
                const scrollTop = Math.max(
                  0,
                  event.currentTarget.scrollTop,
                );
                viewStateRef.current = {
                  ...viewStateRef.current,
                  scrollTop,
                };
                setReadScrollTop(scrollTop);
                runtime.closeContextMenu();
              }}
            >
              <div
                ref={readContentRef}
                className="mx-auto max-w-[780px] whitespace-pre-wrap text-[15px] leading-8 text-slate-200 [overflow-wrap:anywhere]"
              >
                {content.length > 0
                  ? content
                  : (
                    <span className="text-slate-600">
                      空白文本，切回「编辑」模式开始输入。
                    </span>
                  )}
              </div>
            </div>
          </div>
        ) : (
          <div className="relative h-full">
            <CodeMirror
            key={editorInstanceKey}
            ref={editorRef}
            className="h-full min-h-0"
            value={content}
            height="100%"
            theme="none"
            extensions={editorExtensions}
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
              if (update.selectionSet) {
                onInteractionChange(
                  editorActionAdapter.captureInteraction(),
                );
              }
            }}
            />
          </div>
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center justify-between border-t border-white/[0.055] bg-[#1b2027] px-3 text-[10px] text-slate-600">
        <span>
          {viewOptions.readMode ? '阅读模式' : cursor}
        </span>
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

export const plainTextRendererWorkbenchModule: RendererWorkbenchModule<
  typeof plainTextWorkbenchManifest.id
> = {
  manifest: plainTextWorkbenchManifest,
  View: PlainTextWorkbenchView,
};
