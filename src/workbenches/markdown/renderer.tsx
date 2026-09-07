import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { markdown } from '@codemirror/lang-markdown';
import { Transaction } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import CodeMirror, {
  type ReactCodeMirrorRef,
} from '@uiw/react-codemirror';
import 'vditor/dist/index.css';
import './markdown-workbench.css';

import { createEditorActionPreset } from '../../renderer/workbench/actions/editor-action-preset';
import { CodeMirrorEditorActionAdapter } from '../../renderer/workbench/editor/codemirror-action-adapter';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
import {
  getLatestWorkbenchLocationSnapshot,
  publishWorkbenchLocationSnapshot,
} from '../../renderer/workbench/location-snapshot-store';
import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import { useWorkbenchConversationContribution } from '../../renderer/conversation/workbench-conversation-context';
import { useWorkbenchContributions } from '../../renderer/workbench/runtime/use-workbench-contributions';
import { DocumentAiWorkbenchShell } from '../document-ai/renderer/DocumentAiWorkbenchShell';
import {
  createDocumentConversationContext,
  createDocumentConversationContribution,
} from '../document-ai/renderer/conversation/document-conversation-contribution';
import {
  revealSelectionInCodeMirror,
  rangeForExactText,
  rectFromCodeMirrorRange,
  rectFromRange,
  resolveTextSelectionFromTarget,
  scrollRangeIntoView,
  selectTextInElement,
} from '../document-ai/renderer/conversation/document-target-reveal';
import {
  registerWorkbenchTargetController,
  selectAndRevealWorkbenchTarget,
} from '../../renderer/workbench/host/workbench-target-bridge';
import { userMessageFromError } from '../../shared/ipc-error';
import { parseProjectLearningNoteTargetHref } from '../../shared/project-learning-notes';
import type { WorkbenchCommandResult } from '../../shared/workbench/protocol';
import type { AssetTarget } from '../../shared/workbench/asset-target';
import {
  createWorkbenchLocationHref,
  parseWorkbenchLocationHref,
} from '../../shared/workbench/location-reference';
import {
  createTextRangeTarget,
  resolveTextRangeSelection,
} from '../../shared/workbench/text-range-target';
import { MarkdownEditorActionAdapter } from './markdown-editor-action-adapter';
import { MarkdownEditorAdapter } from './markdown-editor-adapter';
import {
  areMarkdownSourceViewStatesEqual,
  cloneMarkdownWorkbenchViewState,
  createMarkdownSaveViewStateCommand,
  createMarkdownImageReference,
  createMarkdownInsertImageCommand,
  createMarkdownReadImageCommand,
  createMarkdownSyncSourceCommand,
  createMarkdownSyncWysiwygCommand,
  isMarkdownBufferSyncResult,
  isMarkdownInsertImageResult,
  isMarkdownLineEndingResult,
  isMarkdownReadImageResult,
  isMarkdownReadConflictStateResult,
  isMarkdownReopenResult,
  isMarkdownResolveConflictResult,
  isMarkdownAdoptSharedResult,
  isMarkdownSaveResult,
  isMarkdownSaveViewStateResult,
  isMarkdownWorkbenchPayload,
  isSupportedMarkdownImageMediaType,
  MARKDOWN_MAX_IMAGE_BYTES,
  markdownCommands,
  markdownImageMediaTypeFromName,
  markdownWorkbenchManifest,
  MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE,
  MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
  MARKDOWN_IMAGE_TARGET_TYPE,
  MARKDOWN_IMAGE_TARGET_VERSION,
  createMarkdownImageTarget,
  isMarkdownImageTargetPayload,
  markdownImageReferenceCandidates,
  type MarkdownBufferSyncResult,
  type MarkdownEditMode,
  type MarkdownEncoding,
  type MarkdownLineEnding,
  type MarkdownReadConflictStateResult,
  type MarkdownConflictBackupResult,
  type MarkdownSourceViewState,
  type MarkdownWorkbenchViewState,
} from './shared';
import {
  createMarkdownRendererActions,
} from './renderer-actions';
import { useMarkdownVisualEditor } from './use-markdown-visual-editor';

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function markdownLocationLinkLabel(text: string): string {
  const compact = text.replace(/\s+/gu, ' ').trim().slice(0, 160);
  const label = compact || '原文位置';
  return label.replace(/[\\\[\]]/gu, '\\$&');
}

/** Returns a portable location href only when the click lies inside its link. */
export function markdownLocationHrefAt(
  line: string,
  offset: number,
): string | undefined {
  const expression = /\[[^\]]*\]\((#[^\s)]+)\)/gu;
  for (const match of line.matchAll(expression)) {
    const href = match[1];
    if (!href || match.index === undefined) continue;
    const hrefStart = match.index + match[0].lastIndexOf(href);
    if (offset >= hrefStart && offset < hrefStart + href.length &&
      (parseWorkbenchLocationHref(href) || parseProjectLearningNoteTargetHref(href))) {
      return href;
    }
  }
  return undefined;
}

function projectLocationReference(
  href: string,
  projectId: string,
) {
  const modern = parseWorkbenchLocationHref(href);
  if (modern?.projectId === projectId) return modern;
  const legacy = parseProjectLearningNoteTargetHref(href);
  return legacy?.projectId === projectId
    ? {
        version: 2 as const,
        projectId: legacy.projectId,
        assetId: legacy.assetId,
        target: legacy.target,
        sourceRevision: legacy.sourceRevision,
      }
    : undefined;
}

function findMarkdownImageByCandidates(
  element: HTMLElement | undefined,
  candidates: readonly string[],
): HTMLImageElement | undefined {
  if (!element) return undefined;
  const images = [...element.querySelectorAll<HTMLImageElement>('img')];
  for (const candidate of candidates) {
    const image = images.find(
      (candidateImage) =>
        candidateImage.getAttribute('data-md-src') === candidate,
    );
    if (image) return image;
  }
  return undefined;
}

const MARKDOWN_ANSWER_ACTION_PRESENTATION = Object.freeze({
  label: '回归 Markdown 原文',
  selectionLabel: '回归选中回答片段',
  successMessage: '已在原文旁创建 AI 回复批注，点击标记即可查看',
  failureMessage: '创建原文回复批注失败',
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

type MarkdownConflictUiState = {
  /** An owned Main recovery entry used for resolve/adopt. */
  readonly conflictId?: string;
  readonly sharedContent: string;
  readonly expectedDocumentVersion: number;
  readonly backups: readonly MarkdownConflictBackupResult[];
  readonly selectedBackupId?: string;
  /** A peer advanced after the user compared the shown shared content. */
  readonly newerShared?: {
    readonly content: string;
    readonly documentVersion: number;
  };
};

type MarkdownInsertionBookmark =
  | {
      readonly kind: 'source';
      readonly assetId: string;
      readonly generation: number;
      readonly view: EditorView;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly kind: 'wysiwyg';
      readonly assetId: string;
      readonly generation: number;
      readonly adapter: MarkdownEditorAdapter;
      readonly range: Range;
    };

export function MarkdownWorkbenchView(props: RendererWorkbenchViewProps) {
  const runtime = useWorkbenchRuntime();
  const {
    bootstrap,
    asset,
    executeCommand,
    onReveal,
    onInteractionChange,
    onOpenExternal,
    onSelectAsset,
    onOpenWorkbenchLocation,
    subscribeEvent,
    onError,
    attachments,
    refreshAttachments,
  } = props;
  const payload = isMarkdownWorkbenchPayload(bootstrap.payload)
    ? bootstrap.payload
    : undefined;
  const [sourceRevision, setSourceRevision] = useState(payload?.revision ?? '');
  const documentVersionRef = useRef(payload?.documentVersion ?? 0);
  const nextDocumentUpdateIdRef = useRef(0);
  const pendingDocumentSyncsRef = useRef(0);
  const syncConflictRef = useRef(false);
  const initialViewState =
    payload?.state ??
    ({
      viewMode: 'wysiwyg',
      wysiwygScrollTop: 0,
      wordWrap: true,
      outlineVisible: false,
    } satisfies MarkdownWorkbenchViewState);
  const sourceEditorRef = useRef<ReactCodeMirrorRef>(null);
  const openWorkbenchLocationRef = useRef<
    ((href: string) => Promise<void>) | undefined
  >(undefined);
  const insertionBookmarkRef = useRef<MarkdownInsertionBookmark | undefined>(
    undefined,
  );
  const imageInputRef = useRef<HTMLInputElement>(null);
  const wysiwygAdapterRef = useRef<MarkdownEditorAdapter | undefined>(
    undefined,
  );
  const workingBufferRef = useRef(
    payload?.workingBuffer ?? payload?.diskSource ?? '',
  );
  const sourceInitialValueRef = useRef(
    payload?.workingBuffer ?? payload?.diskSource ?? '',
  );
  const applyingRemoteSourceRef = useRef(false);
  const lineEndingRef = useRef<MarkdownLineEnding>(
    payload?.lineEnding ?? 'lf',
  );
  const viewStateRef = useRef<MarkdownWorkbenchViewState>(
    cloneMarkdownWorkbenchViewState(initialViewState),
  );
  const wysiwygEditedSinceMountRef = useRef(false);
  const viewStateSaveTimerRef = useRef<number | undefined>(undefined);
  const imageDataUrlCacheRef = useRef<
    Map<string, Promise<string | undefined>>
  >(new Map());
  const imageAiAskRef = useRef<
    ((relativePath: string) => void) | undefined
  >(undefined);
  const [workingBuffer, setWorkingBuffer] = useState(
    payload?.workingBuffer ?? payload?.diskSource ?? '',
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
  const [recovery, setRecovery] = useState(payload?.recovery);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sourceEditorKey, setSourceEditorKey] = useState(0);
  const [wysiwygEditorKey, setWysiwygEditorKey] = useState(0);
  const [cursor, setCursor] = useState('第 1 行，第 1 列');
  const [syncConflict, setSyncConflict] = useState<string | undefined>();
  /**
   * This is intentionally separate from documentVersionRef. The latter tracks
   * ordinary document events; a conflict CAS is against the shared snapshot
   * the user actually compared while editing the merge draft.
   */
  const conflictStateRef = useRef<MarkdownConflictUiState | undefined>(undefined);
  const [conflictState, setConflictState] = useState<
    MarkdownConflictUiState | undefined
  >();
  const dirty =
    workingBuffer !== diskSource || lineEnding !== savedLineEnding;

  const reportMarkdownInteraction = useCallback(
    (interaction: Parameters<typeof onInteractionChange>[0]) => {
      onInteractionChange(interaction);
    },
    [onInteractionChange],
  );

  const captureLocationReference = useCallback(
    (text: string, target: AssetTarget) => {
      // The Target and revision are frozen in this same explicit operation.
      // A dirty in-memory buffer has no honest source revision to export.
      if (
        workingBufferRef.current !== diskSource ||
        lineEndingRef.current !== savedLineEnding ||
        !sourceRevision ||
        target.scope !== 'content'
      ) {
        throw new Error('请先保存 Markdown，再设为引用来源。');
      }
      publishWorkbenchLocationSnapshot(markdownWorkbenchManifest, {
        ownerId: bootstrap.sessionId,
        projectId: asset.projectId,
        reference: {
          version: 2,
          projectId: asset.projectId,
          assetId: asset.id,
          target,
          sourceRevision,
        },
        text,
      });
    },
    [
      asset.id,
      asset.projectId,
      bootstrap.sessionId,
      diskSource,
      savedLineEnding,
      sourceRevision,
    ],
  );

  const updateConflictState = useCallback(
    (next: MarkdownConflictUiState | undefined) => {
      conflictStateRef.current = next;
      setConflictState(next);
    },
    [],
  );

  const readConflictState = useCallback(async () => {
    const result = await executeCommand({
      type: markdownCommands.readConflictState,
    });
    if (!isMarkdownReadConflictStateResult(result.payload)) {
      throw new Error('Markdown Workbench 冲突状态响应无效');
    }
    return result.payload as MarkdownReadConflictStateResult;
  }, [executeCommand]);

  const loadConflictState = useCallback(async (
    message: string,
    options?: {
      readonly preferredConflictId?: string;
      /** Keep the comparison immutable but disclose a newer shared version. */
      readonly preserveComparison?: boolean;
    },
  ) => {
    syncConflictRef.current = true;
    setSyncConflict(message);
    const result = await readConflictState();
    const current = conflictStateRef.current;
    const conflictId = options?.preferredConflictId ?? current?.conflictId ??
      result.conflicts.find((item) => 'content' in item)?.conflictId ??
      result.conflicts[0]?.conflictId;
    if (options?.preserveComparison && current) {
      updateConflictState({
        ...current,
        backups: result.conflicts,
        newerShared: {
          content: result.sharedContent,
          documentVersion: result.documentVersion,
        },
      });
      return result;
    }
    updateConflictState({
      conflictId,
      sharedContent: result.sharedContent,
      expectedDocumentVersion: result.documentVersion,
      backups: result.conflicts,
      selectedBackupId: conflictId,
    });
    return result;
  }, [readConflictState, updateConflictState]);

  useEffect(() => {
    if (!subscribeEvent) return;
    return subscribeEvent((event) => {
      if (
        event.type !== 'markdown:document-changed' ||
        typeof event.payload !== 'object' ||
        event.payload === null ||
        Array.isArray(event.payload)
      ) {
        return;
      }
      const change = event.payload as Readonly<Record<string, unknown>>;
      if (
        typeof change.content !== 'string' ||
        typeof change.diskSource !== 'string' ||
        (change.lineEnding !== 'lf' && change.lineEnding !== 'crlf') ||
        (change.savedLineEnding !== 'lf' && change.savedLineEnding !== 'crlf') ||
        typeof change.revision !== 'string' ||
        typeof change.dirty !== 'boolean' ||
        typeof change.documentVersion !== 'number' ||
        !Number.isSafeInteger(change.documentVersion) ||
        change.documentVersion <= documentVersionRef.current
      ) {
        return;
      }
      if (pendingDocumentSyncsRef.current > 0) {
        syncConflictRef.current = true;
        setSyncConflict(
          '另一视口已修改此 Markdown；当前草稿已保留，请先处理冲突后再保存。',
        );
        updateConflictState({
          conflictId: conflictStateRef.current?.conflictId,
          sharedContent: change.content,
          expectedDocumentVersion: change.documentVersion,
          backups: conflictStateRef.current?.backups ?? [],
          selectedBackupId: conflictStateRef.current?.selectedBackupId,
        });
        return;
      }
      // A rejected local version is a persistent conflict, not a transient
      // pending request. Keep the draft intact across every later peer event.
      if (syncConflictRef.current) {
        documentVersionRef.current = Math.max(
          documentVersionRef.current,
          change.documentVersion,
        );
        const currentConflict = conflictStateRef.current;
        if (currentConflict) {
          updateConflictState({
            ...currentConflict,
            newerShared: {
              content: change.content,
              documentVersion: change.documentVersion,
            },
          });
        }
        // Peer disk transitions are still useful as a dirty baseline. They
        // must never replace the locally editable merge draft.
        setDiskSource(change.diskSource);
        setSavedLineEnding(change.savedLineEnding);
        setSourceRevision(change.revision);
        return;
      }
      // Never remount an editor for a peer update: that loses undo/IME and
      // local cursor state. CodeMirror receives a transaction; Vditor's
      // adapter suppresses its input callback while applying the value.
      if (viewStateRef.current.viewMode === 'source') {
        const editor = sourceEditorRef.current?.view;
        if (editor && !editor.composing) {
          applyingRemoteSourceRef.current = true;
          const current = editor.state.doc.toString();
          let prefix = 0;
          while (
            prefix < current.length &&
            prefix < change.content.length &&
            current[prefix] === change.content[prefix]
          ) {
            prefix += 1;
          }
          let suffix = 0;
          while (
            suffix < current.length - prefix &&
            suffix < change.content.length - prefix &&
            current[current.length - suffix - 1] ===
              change.content[change.content.length - suffix - 1]
          ) {
            suffix += 1;
          }
          editor.dispatch({
            changes: {
              from: prefix,
              to: current.length - suffix,
              insert: change.content.slice(
                prefix,
                change.content.length - suffix,
              ),
            },
            annotations: Transaction.addToHistory.of(false),
          });
          queueMicrotask(() => {
            applyingRemoteSourceRef.current = false;
          });
        }
      } else {
        wysiwygAdapterRef.current?.setValue(change.content);
      }
      documentVersionRef.current = change.documentVersion;
      workingBufferRef.current = change.content;
      lineEndingRef.current = change.lineEnding;
      setWorkingBuffer(change.content);
      setDiskSource(change.diskSource);
      setLineEnding(change.lineEnding);
      setSavedLineEnding(change.savedLineEnding);
      setSourceRevision(change.revision);
    });
  }, [subscribeEvent, updateConflictState]);

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

  useEffect(() => {
    const conflict = payload?.conflictRecovery;
    if (!conflict) return;
    void loadConflictState(
      '发现一份未解决的 Markdown 冲突草稿。请选择恢复后手动合并，或采用共享版本。',
      { preferredConflictId: conflict.conflictId },
    ).catch((error) => {
      reportError(error, '无法读取 Markdown 冲突草稿。');
    });
  }, [
    bootstrap.sessionId,
    loadConflictState,
    payload?.conflictRecovery?.conflictId,
    reportError,
  ]);

  const sourceExtensions = useMemo(() => {
    const extensions = [markdown(), markdownSourceTheme];

    if (viewState.wordWrap) {
      extensions.push(EditorView.lineWrapping);
    }

    return extensions;
  }, [viewState.wordWrap]);

  const sourceLocationLinkExtension = useMemo(
    () => EditorView.domEventHandlers({
      click(event, view) {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null) return false;
        const line = view.state.doc.lineAt(position);
        const href = markdownLocationHrefAt(
          line.text,
          position - line.from,
        );
        if (!href || !projectLocationReference(href, asset.projectId)) {
          return false;
        }
        event.preventDefault();
        void openWorkbenchLocationRef.current?.(href);
        return true;
      },
    }),
    [asset.projectId],
  );

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
      const view = sourceEditorRef.current?.view;
      const range = view?.state.selection.main;
      insertionBookmarkRef.current = view && range
        ? {
            kind: 'source', assetId: asset.id, generation: sourceEditorKey,
            view, from: range.from, to: range.to,
          }
        : undefined;
      runtime.openContextMenu(
        bootstrap.sessionId,
        { x: event.clientX, y: event.clientY },
        capture.interaction,
        { onWheel: capture.onWheel },
      );
    },
    [
      bootstrap.sessionId,
      asset.id,
      recovery,
      runtime,
      sourceEditorKey,
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
    () => [
      ...sourceExtensions,
      sourceContextMenuExtension,
      sourceLocationLinkExtension,
    ],
    [sourceContextMenuExtension, sourceExtensions, sourceLocationLinkExtension],
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
      pendingDocumentSyncsRef.current += 1;
      try {
        const result = await executeCommand(
          createMarkdownSyncSourceCommand({
          content,
          lineEnding: lineEndingRef.current,
          sourceViewState,
          baseDocumentVersion: documentVersionRef.current,
          updateId: ++nextDocumentUpdateIdRef.current,
          }),
        );
        const accepted = acceptSyncResult(result);
        if (accepted.documentVersion !== undefined) {
          documentVersionRef.current = Math.max(
            documentVersionRef.current,
            accepted.documentVersion,
          );
        }
        return accepted;
      } catch (error) {
        await loadConflictState(
          '本地草稿与另一视口冲突，草稿已保留。请手动合并后应用合并结果，或采用共享版本。',
        );
        throw error;
      } finally {
        pendingDocumentSyncsRef.current -= 1;
      }
    },
    [acceptSyncResult, executeCommand, loadConflictState],
  );

  const syncWysiwygBuffer = useCallback(
    async (content: string, scrollTop: number) => {
      pendingDocumentSyncsRef.current += 1;
      try {
        const result = await executeCommand(
          createMarkdownSyncWysiwygCommand({
          content,
          lineEnding: lineEndingRef.current,
          wysiwygScrollTop: scrollTop,
          baseDocumentVersion: documentVersionRef.current,
          updateId: ++nextDocumentUpdateIdRef.current,
          }),
        );
        const accepted = acceptSyncResult(result);
        if (accepted.documentVersion !== undefined) {
          documentVersionRef.current = Math.max(
            documentVersionRef.current,
            accepted.documentVersion,
          );
        }
        return accepted;
      } catch (error) {
        await loadConflictState(
          '本地草稿与另一视口冲突，草稿已保留。请手动合并后应用合并结果，或采用共享版本。',
        );
        throw error;
      } finally {
        pendingDocumentSyncsRef.current -= 1;
      }
    },
    [acceptSyncResult, executeCommand, loadConflictState],
  );

  const replaceConflictDraft = useCallback((content: string) => {
    const editor = sourceEditorRef.current?.view;
    if (editor?.composing) {
      throw new Error('请先完成当前输入法组合，再恢复冲突草稿。');
    }
    workingBufferRef.current = content;
    sourceInitialValueRef.current = content;
    setWorkingBuffer(content);
    if (viewStateRef.current.viewMode === 'source' && editor) {
      applyingRemoteSourceRef.current = true;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: content },
        annotations: Transaction.addToHistory.of(false),
      });
      queueMicrotask(() => {
        applyingRemoteSourceRef.current = false;
      });
      return;
    }
    // Recovery is intentionally edited in Source mode. This makes both the
    // local draft and the read-only shared snapshot visible, while normal
    // WYSIWYG editing remains available outside conflict handling.
    applyViewState({
      ...viewStateRef.current,
      viewMode: 'source',
    });
  }, [applyViewState]);

  const refreshConflictComparison = useCallback(async () => {
    try {
      await loadConflictState(
        '共享版本已刷新。请确认合并内容后再应用。',
        { preferredConflictId: conflictStateRef.current?.conflictId },
      );
    } catch (error) {
      reportError(error, '无法刷新 Markdown 共享版本。');
    }
  }, [loadConflictState, reportError]);

  const restoreConflictBackup = useCallback((conflictId: string) => {
    const conflict = conflictStateRef.current;
    const backup = conflict?.backups.find(
      (item) => item.conflictId === conflictId,
    );
    if (!conflict || !backup || !('content' in backup)) {
      reportError(
        new Error('该冲突备份已不可读取，无法恢复。'),
        '无法恢复 Markdown 冲突草稿。',
      );
      return;
    }
    try {
      replaceConflictDraft(backup.content);
      updateConflictState({
        ...conflict,
        selectedBackupId: conflictId,
      });
    } catch (error) {
      reportError(error, '无法恢复 Markdown 冲突草稿。');
    }
  }, [replaceConflictDraft, reportError, updateConflictState]);

  const applyConflictMerge = useCallback(async () => {
    const conflict = conflictStateRef.current;
    if (!conflict?.conflictId) {
      reportError(new Error('缺少可解决的冲突草稿。'), '无法应用 Markdown 合并结果。');
      return;
    }
    if (conflict.newerShared) {
      setSyncConflict('共享版本在对照后已更新；请先刷新共享对照并重新确认合并结果。');
      return;
    }
    try {
      const result = await executeCommand({
        type: markdownCommands.resolveConflict,
        payload: {
          conflictId: conflict.conflictId,
          expectedDocumentVersion: conflict.expectedDocumentVersion,
          content: workingBufferRef.current,
        },
      });
      if (!isMarkdownResolveConflictResult(result.payload)) {
        throw new Error('Markdown Workbench 合并响应无效');
      }
      documentVersionRef.current = result.payload.documentVersion;
      syncConflictRef.current = false;
      setSyncConflict(undefined);
      updateConflictState(undefined);
    } catch (error) {
      // Main persisted this newest merge candidate before rejecting stale CAS.
      // Refresh only the disclosed latest snapshot; never replace the draft.
      try {
        await loadConflictState(
          '共享版本在应用期间又发生变化；最新合并稿已备份，请刷新对照后重新确认。',
          {
            preferredConflictId: conflict.conflictId,
            preserveComparison: true,
          },
        );
      } catch (readError) {
        reportError(readError, '无法读取 Markdown 最新冲突状态。');
      }
      reportError(error, '无法应用 Markdown 合并结果。');
    }
  }, [executeCommand, loadConflictState, reportError, updateConflictState]);

  const adoptSharedConflict = useCallback(async () => {
    const conflict = conflictStateRef.current;
    if (!conflict?.conflictId) {
      reportError(new Error('缺少可采用的共享版本。'), '无法采用 Markdown 共享版本。');
      return;
    }
    try {
      const result = await executeCommand({
        type: markdownCommands.adoptShared,
        payload: { conflictId: conflict.conflictId },
      });
      if (!isMarkdownAdoptSharedResult(result.payload)) {
        throw new Error('Markdown Workbench 采用共享版本响应无效');
      }
      replaceConflictDraft(result.payload.sharedContent);
      documentVersionRef.current = result.payload.documentVersion;
      syncConflictRef.current = false;
      setSyncConflict(undefined);
      updateConflictState(undefined);
    } catch (error) {
      reportError(error, '无法采用 Markdown 共享版本。');
    }
  }, [executeCommand, replaceConflictDraft, reportError, updateConflictState]);

  const readMarkdownImageDataUrl = useCallback(
    async (relativePath: string): Promise<string | undefined> => {
      const cached =
        imageDataUrlCacheRef.current.get(relativePath);
      if (cached) return cached;
      const pending = executeCommand(
        createMarkdownReadImageCommand(relativePath),
      )
        .then((result) =>
          isMarkdownReadImageResult(result.payload)
            ? result.payload.dataUrl
            : undefined,
        )
        .catch(() => undefined);
      imageDataUrlCacheRef.current.set(relativePath, pending);
      return pending;
    },
    [executeCommand],
  );

  // Used only by the compatibility fallback below. Project hosts provide the
  // public navigator, whose lifetime is intentionally longer than this view.
  const locationNavigationRef = useRef<AbortController | undefined>(undefined);
  const openWorkbenchLocation = useCallback(
    async (href: string) => {
      if (onOpenWorkbenchLocation) {
        await onOpenWorkbenchLocation(href);
        return;
      }
      const reference = projectLocationReference(href, asset.projectId);
      if (!reference) {
        throw new Error('这条位置引用不属于当前 Project。');
      }
      if (!onSelectAsset) {
        throw new Error('当前 Markdown 视口不能打开引用资料。');
      }
      locationNavigationRef.current?.abort(
        new DOMException('已开始新的 Markdown 定位。', 'AbortError'),
      );
      const controller = new AbortController();
      locationNavigationRef.current = controller;
      try {
        await selectAndRevealWorkbenchTarget({
          assetId: reference.assetId,
          target: reference.target,
          ...(reference.sourceRevision
            ? { sourceRevision: reference.sourceRevision }
            : {}),
          selectAsset: onSelectAsset,
          signal: controller.signal,
          timeoutMs: 10_000,
          emphasize: true,
        });
      } finally {
        if (locationNavigationRef.current === controller) {
          locationNavigationRef.current = undefined;
        }
      }
    },
    [asset.projectId, onOpenWorkbenchLocation, onSelectAsset],
  );

  useEffect(() => {
    openWorkbenchLocationRef.current = openWorkbenchLocation;
    return () => {
      if (openWorkbenchLocationRef.current === openWorkbenchLocation) {
        openWorkbenchLocationRef.current = undefined;
      }
    };
  }, [openWorkbenchLocation]);

  const insertLocationReference = useCallback(async () => {
    const snapshot = getLatestWorkbenchLocationSnapshot(asset.projectId);
    if (!snapshot) {
      throw new Error('请先在已保存的资料中选中一段内容。');
    }
    const href = createWorkbenchLocationHref(snapshot.reference);
    const markdown = `[${markdownLocationLinkLabel(snapshot.text)}](${href})`;
    const bookmark = insertionBookmarkRef.current;
    if (!bookmark || bookmark.assetId !== asset.id) {
      throw new Error('插入位置已失效，请在目标 Markdown 中重新打开菜单。');
    }

    if (bookmark.kind === 'source') {
      if (
        viewStateRef.current.viewMode !== 'source' ||
        bookmark.generation !== sourceEditorKey ||
        sourceEditorRef.current?.view !== bookmark.view
      ) {
        throw new Error('目标 Markdown 源码编辑器已切换，请重新打开菜单。');
      }
      bookmark.view.dispatch({
        changes: { from: bookmark.from, to: bookmark.to, insert: markdown },
        selection: { anchor: bookmark.from + markdown.length },
        scrollIntoView: true,
      });
      bookmark.view.focus();
      return;
    }

    if (
      viewStateRef.current.viewMode !== 'wysiwyg' ||
      bookmark.generation !== wysiwygEditorKey ||
      wysiwygAdapterRef.current !== bookmark.adapter
    ) {
      throw new Error('目标 Markdown 可视化编辑器已切换，请重新打开菜单。');
    }
    const element = bookmark.adapter.getEditableElement();
    if (!element || !element.contains(bookmark.range.startContainer) ||
      !element.contains(bookmark.range.endContainer)) {
      throw new Error('目标 Markdown 插入位置已失效，请重新打开菜单。');
    }
    element.focus();
    const selection = element.ownerDocument.defaultView?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(bookmark.range.cloneRange());
    bookmark.adapter.insertMarkdown(markdown);
  }, [asset.id, asset.projectId, sourceEditorKey, wysiwygEditorKey]);

  const resolvePickedImageMediaType = useCallback(
    (file: File) => {
      if (isSupportedMarkdownImageMediaType(file.type)) {
        return file.type;
      }
      const byName = markdownImageMediaTypeFromName(file.name);
      return byName && isSupportedMarkdownImageMediaType(byName)
        ? byName
        : undefined;
    },
    [],
  );

  const insertLocalImage = useCallback(
    async (file: File) => {
      try {
        if (
          file.size === 0 ||
          file.size > MARKDOWN_MAX_IMAGE_BYTES
        ) {
          throw new Error(
            `图片不能超过 ${Math.round(
              MARKDOWN_MAX_IMAGE_BYTES / 1024 / 1024,
            )} MB。`,
          );
        }
        const mediaType = resolvePickedImageMediaType(file);
        if (!mediaType) {
          throw new Error('仅支持 PNG / JPG / GIF / WebP / BMP 图片。');
        }
        const data = await fileToBase64(file);
        const result = await executeCommand(
          createMarkdownInsertImageCommand({
            name: file.name,
            mediaType,
            data,
          }),
        );
        if (!isMarkdownInsertImageResult(result.payload)) {
          throw new Error('插入图片响应无效。');
        }
        const reference = createMarkdownImageReference(
          result.payload.relativePath,
        );
        if (viewStateRef.current.viewMode === 'source') {
          const view = sourceEditorRef.current?.view;
          if (!view) {
            throw new Error('Markdown 源码编辑器尚未准备完成。');
          }
          const from = view.state.selection.main.from;
          view.dispatch({
            changes: { from, insert: reference },
            selection: { anchor: from + reference.length },
            scrollIntoView: true,
          });
          view.focus();
        } else {
          const adapter = wysiwygAdapterRef.current;
          if (!adapter) {
            throw new Error('Markdown 可视化编辑器尚未准备完成。');
          }
          adapter.insertMarkdown(reference);
          requestAnimationFrame(() => {
            adapter.resolveLocalImages();
          });
        }
        void readMarkdownImageDataUrl(
          result.payload.relativePath,
        );
      } catch (error) {
        reportError(error, '无法插入本地图片，请重试。');
      }
    },
    [
      executeCommand,
      readMarkdownImageDataUrl,
      reportError,
      resolvePickedImageMediaType,
    ],
  );

  const handleImageInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void insertLocalImage(file);
    },
    [insertLocalImage],
  );

  const {
    hostRef: wysiwygHostRef,
    state: visualEditorState,
  } = useMarkdownVisualEditor({
    enabled:
      Boolean(payload) &&
      !recovery &&
      viewState.viewMode === 'wysiwyg',
    resetKey: wysiwygEditorKey,
    initialValue: workingBufferRef.current,
    initialScrollTop: viewStateRef.current.wysiwygScrollTop,
    outlineVisible: viewStateRef.current.outlineVisible,
    onInput: (value) => {
      const adapter = wysiwygAdapterRef.current;
      const normalizedValue = adapter
        ? adapter.normalizeImageSourcesForSource(value)
        : value;
      const scrollTop = adapter?.getScrollTop() ?? 0;
      workingBufferRef.current = normalizedValue;
      wysiwygEditedSinceMountRef.current = true;
      setWorkingBuffer(normalizedValue);
      void syncWysiwygBuffer(normalizedValue, scrollTop).catch(
        (error) => {
          reportError(error, '无法同步 Markdown 可视化编辑内容。');
        },
      );
    },
    onScroll: (scrollTop) => {
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
    isInternalLinkAllowed: (href) =>
      projectLocationReference(href, asset.projectId) !== undefined,
    onOpenInternalLink: (href) => {
      void openWorkbenchLocation(href).catch((error) => {
        reportError(error, '无法定位 Markdown 中的资料引用。');
      });
    },
    readLocalImageSource: readMarkdownImageDataUrl,
    onError: (error) => {
      reportError(error, 'Markdown 可视化编辑器运行异常。');
    },
    onAdapterChange: (adapter) => {
      wysiwygAdapterRef.current = adapter;
      if (adapter) {
        wysiwygEditedSinceMountRef.current = false;
      }
    },
  });

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
      const imageTarget =
        event.target instanceof Element
          ? event.target.closest('img')
          : undefined;
      const imageRelativePath = imageTarget?.getAttribute(
        'data-md-src',
      );
      const askAboutImage = imageAiAskRef.current;
      if (imageRelativePath && askAboutImage) {
        askAboutImage(imageRelativePath);
        return;
      }
      const capture =
        wysiwygEditorActionAdapter.captureContextMenu(
          event.clientX,
          event.clientY,
        );
      const adapter = wysiwygAdapterRef.current;
      const selection = element.ownerDocument.defaultView?.getSelection();
      const range = selection?.rangeCount
        ? selection.getRangeAt(0).cloneRange()
        : undefined;
      insertionBookmarkRef.current = adapter && range
        ? {
            kind: 'wysiwyg', assetId: asset.id,
            generation: wysiwygEditorKey, adapter, range,
          }
        : undefined;
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

      reportMarkdownInteraction(
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
    asset.id,
    reportMarkdownInteraction,
    recovery,
    runtime,
    visualEditorState,
    viewState.viewMode,
    wysiwygEditorKey,
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
        reportMarkdownInteraction({ inputs: [] });
        applyViewState(next);
        await persistViewState(next);

        if (mode === 'source') {
          sourceInitialValueRef.current = workingBufferRef.current;
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
      reportMarkdownInteraction,
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
    if (!dirty || saving || recovery || syncConflictRef.current) {
      return;
    }

    setSaving(true);
    try {
      await flushCurrentBuffer();
      const submittedBuffer = workingBufferRef.current;
      const submittedLineEnding = lineEndingRef.current;

      const result = await executeCommand({
        type: markdownCommands.save,
      });
      requireValidResult(
        result,
        isMarkdownSaveResult,
        'Markdown Workbench 保存响应无效',
      );
      setSourceRevision(result.payload.revision);
      setDiskSource(submittedBuffer);
      setSavedLineEnding(submittedLineEnding);
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
    syncConflict,
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
      if (applyingRemoteSourceRef.current) {
        return;
      }
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
        reportMarkdownInteraction(
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
      reportMarkdownInteraction,
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
        sourceInitialValueRef.current = workingBufferRef.current;
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
        setSourceRevision(result.payload.revision);
        workingBufferRef.current = result.payload.diskSource;
        lineEndingRef.current = result.payload.lineEnding;
        setWorkingBuffer(result.payload.diskSource);
        setDiskSource(result.payload.diskSource);
        setEncoding(result.payload.encoding);
        setLineEnding(result.payload.lineEnding);
        setSavedLineEnding(result.payload.lineEnding);
        if (viewStateRef.current.viewMode === 'source') {
          sourceInitialValueRef.current = workingBufferRef.current;
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

  const conversationContribution = useMemo(
    () => createDocumentConversationContribution({
      projectId: asset.projectId,
      assetId: asset.id,
      allowAnswerAttachments: true,
      answerActionPresentation: MARKDOWN_ANSWER_ACTION_PRESENTATION,
    }),
    [asset.id, asset.projectId],
  );
  const conversationOwnerId =
    `${markdownWorkbenchManifest.id}:${bootstrap.sessionId}.conversation`;
  const conversationRuntime = useWorkbenchConversationContribution(
    conversationOwnerId,
    asset.id,
    conversationContribution,
  );

  useEffect(() => {
    imageAiAskRef.current = (relativePath) => {
      conversationRuntime.open({
        ownerId: conversationOwnerId,
        context: createDocumentConversationContext({
          target: createMarkdownImageTarget(relativePath),
          image: { relativePath },
        }),
        question: '请解释这张图片的内容。',
      });
    };
    return () => {
      imageAiAskRef.current = undefined;
    };
  }, [conversationOwnerId, conversationRuntime]);

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
        return true;
      }
      return false;
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
        const view = sourceEditorRef.current?.view;
        if (!view || clampedEnd <= clampedStart) return false;
        revealSelectionInCodeMirror(view, clampedStart, clampedEnd);
        return true;
      }

      const element = wysiwygAdapterRef.current?.getEditableElement();
      if (!element || clampedEnd <= clampedStart) {
        return false;
      }

      const text = source.slice(clampedStart, clampedEnd).trim();
      if (!text) {
        return false;
      }
      if (selectTextInElement(element, text)) {
        scrollSelectionIntoView();
        return true;
      }
      return revealTextFragmentInElement(element, text);
    },
    [revealTextFragmentInElement, scrollSelectionIntoView],
  );

  const revealMarkdownText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return false;
      }

      if (viewStateRef.current.viewMode === 'wysiwyg') {
        const element = wysiwygAdapterRef.current?.getEditableElement();
        if (!element) {
          return false;
        }
        if (selectTextInElement(element, trimmed)) {
          scrollSelectionIntoView();
          return true;
        }
        return revealTextFragmentInElement(element, trimmed);
      }

      const source = workingBufferRef.current;
      const index = source.indexOf(trimmed);
      const view = sourceEditorRef.current?.view;
      if (index < 0 || !view) return false;
      revealSelectionInCodeMirror(
        view,
        index,
        index + trimmed.length,
      );
      return true;
    },
    [revealTextFragmentInElement, scrollSelectionIntoView],
  );

  const resolveMarkdownVisualTextRect = useCallback(
    (element: HTMLElement, text: string) => {
      const trimmed = text.trim();
      const exactRange = trimmed
        ? rangeForExactText(element, trimmed)
        : undefined;
      if (exactRange) return rectFromRange(exactRange);
      const fragment = Array.from(trimmed)
        .slice(0, 12)
        .join('')
        .replace(/\s+/gu, ' ')
        .trim();
      if (fragment.length < 2) return undefined;
      const fragmentRange = rangeForExactText(element, fragment);
      return fragmentRange ? rectFromRange(fragmentRange) : undefined;
    },
    [],
  );

  const resolveMarkdownTargetRect = useCallback(
    (target: AssetTarget) => {
      if (target.scope !== 'content') return undefined;
      const viewMode = viewStateRef.current.viewMode;
      if (target.targetType === MARKDOWN_IMAGE_TARGET_TYPE) {
        if (
          target.targetVersion !== MARKDOWN_IMAGE_TARGET_VERSION ||
          !isMarkdownImageTargetPayload(target.targetPayload)
        ) {
          return undefined;
        }
        const image = findMarkdownImageByCandidates(
          wysiwygAdapterRef.current?.getEditableElement(),
          markdownImageReferenceCandidates(
            target.targetPayload.relativePath,
          ),
        );
        if (!image) return undefined;
        const rect = image.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return undefined;
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
      }
      if (target.targetType === MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE) {
        const selection = resolveTextSelectionFromTarget(target, [
          MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
        ]);
        if (!selection) return undefined;
        if (viewMode === 'source') {
          const view = sourceEditorRef.current?.view;
          if (!view) return undefined;
          const resolved = resolveTextRangeSelection(
            view.state.doc.toString(),
            target,
          );
          if (!resolved) return undefined;
          return rectFromCodeMirrorRange(
            view,
            resolved.start,
            resolved.end,
          );
        }
        const element =
          wysiwygAdapterRef.current?.getEditableElement();
        if (!element) return undefined;
        const resolved = resolveTextRangeSelection(
          workingBufferRef.current,
          target,
        );
        if (!resolved) return undefined;
        return resolveMarkdownVisualTextRect(
          element,
          workingBufferRef.current.slice(
            resolved.start,
            resolved.end,
          ),
        );
      }

      if (target.targetType === MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE) {
        const payload = target.targetPayload as {
          readonly exact?: unknown;
        };
        const text =
          typeof payload.exact === 'string' ? payload.exact : '';
        if (!text.trim()) return undefined;
        if (viewMode === 'wysiwyg') {
          const element =
            wysiwygAdapterRef.current?.getEditableElement();
          if (!element) return undefined;
          return resolveMarkdownVisualTextRect(element, text);
        }
        const view = sourceEditorRef.current?.view;
        if (!view) return undefined;
        const trimmed = text.trim();
        const doc = view.state.doc.toString();
        const index = doc.indexOf(trimmed);
        if (index < 0) return undefined;
        return rectFromCodeMirrorRange(
          view,
          index,
          index + trimmed.length,
        );
      }
      return undefined;
    },
    [resolveMarkdownVisualTextRect],
  );

  useEffect(() => {
    return registerWorkbenchTargetController(
      `${conversationOwnerId}.targets`,
      asset.id,
      {
        // A dirty editor no longer materializes the revision on disk. Do not
        // let direct-reference navigation claim it can reveal that stale file
        // revision against the unsaved local document.
        ...(dirty ? {} : { sourceRevision }),
        resolve(target) {
          return resolveMarkdownTargetRect(target);
        },
        reveal(target) {
          if (target.scope !== 'content') return false;
          if (target.targetType === MARKDOWN_IMAGE_TARGET_TYPE) {
            if (
              target.targetVersion !== MARKDOWN_IMAGE_TARGET_VERSION ||
              !isMarkdownImageTargetPayload(target.targetPayload)
            ) {
              return false;
            }
            const relativePath = target.targetPayload.relativePath;
            const candidates =
              markdownImageReferenceCandidates(relativePath);
            if (viewStateRef.current.viewMode !== 'source') {
              const image = findMarkdownImageByCandidates(
                wysiwygAdapterRef.current?.getEditableElement(),
                candidates,
              );
              if (!image) return false;
              image.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
              });
              const previousOutline = image.style.outline;
              const previousOffset = image.style.outlineOffset;
              image.style.outline =
                '2px solid rgba(129,140,248,0.9)';
              image.style.outlineOffset = '2px';
              window.setTimeout(() => {
                image.style.outline = previousOutline;
                image.style.outlineOffset = previousOffset;
              }, 1_600);
              return true;
            }
            const view = sourceEditorRef.current?.view;
            if (!view) return false;
            const doc = view.state.doc.toString();
            for (const candidate of candidates) {
              const index = doc.indexOf(candidate);
              if (index < 0) continue;
              revealSelectionInCodeMirror(
                view,
                index,
                index + candidate.length,
              );
              return true;
            }
            return false;
          }
          if (target.targetType === MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE) {
            const selection = resolveTextSelectionFromTarget(target, [
              MARKDOWN_SOURCE_RANGE_ANCHOR_TYPE,
            ]);
            return selection
              ? revealMarkdownSelection(selection.start, selection.end)
              : false;
          }

          if (target.targetType === MARKDOWN_VISUAL_SELECTION_ANCHOR_TYPE) {
            const payload = target.targetPayload as {
              readonly exact?: unknown;
            };
            const text =
              typeof payload.exact === 'string' ? payload.exact : '';
            return revealMarkdownText(text);
          }
          return false;
        },
      },
      bootstrap.viewportId,
    );
  }, [
    asset.id,
    conversationOwnerId,
    resolveMarkdownTargetRect,
    revealMarkdownSelection,
    revealMarkdownText,
    sourceRevision,
    dirty,
  ]);

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
        canCaptureLocationReference: () =>
          workingBufferRef.current === diskSource &&
          lineEndingRef.current === savedLineEnding &&
          Boolean(sourceRevision),
        onAiExplain: (text, target) => {
          conversationRuntime.open({
            ownerId: conversationOwnerId,
            context: createDocumentConversationContext({
              target,
              selectedText: text,
            }),
          });
        },
        onInsertLocationReference: insertLocationReference,
        onCaptureLocationReference: captureLocationReference,
        onSetEncoding: reopenWithEncoding,
        onSetLineEnding: updateLineEnding,
        onSetViewState: updateViewState,
        onReveal,
      }),
    [
      dirty,
      captureLocationReference,
      encoding,
      insertLocationReference,
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
        <div className="flex shrink-0 items-center gap-2">
          {payload.conflictBackupsAvailable && !syncConflict ? (
            <button
              type="button"
              disabled={Boolean(recovery) || saving}
              onClick={() =>
                void loadConflictState(
                  '已打开保留的冲突草稿。请选择草稿后在源码模式手动合并。',
                )
              }
              className="ui-control h-[28px] rounded-lg border border-amber-200/20 px-3 text-[10px] font-medium text-amber-100 disabled:cursor-not-allowed disabled:opacity-35"
            >
              恢复冲突草稿
            </button>
          ) : null}
          <button
            type="button"
            disabled={Boolean(recovery) || saving}
            onClick={() => imageInputRef.current?.click()}
            className="ui-control h-[28px] rounded-lg border border-white/[0.09] px-3 text-[10px] font-medium text-slate-300 hover:border-indigo-300/30 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-35"
            title="从本地文件插入图片；图片会复制到 Markdown 同目录的 images 文件夹"
          >
            + 图片
          </button>
          <button
            type="button"
            disabled={!dirty || saving || Boolean(recovery) || Boolean(syncConflict)}
            onClick={() => void save()}
            className="ui-control h-[28px] rounded-lg border border-white/[0.09] px-3 text-[10px] font-medium text-slate-300 disabled:cursor-not-allowed disabled:opacity-35"
            title="保存 Markdown（⌘/Ctrl + S）"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {syncConflict ? (
        <div role="alert" className="border-b border-amber-300/20 bg-amber-100/10 px-3 py-2 text-xs text-amber-100">
          {syncConflict}
          <p className="mt-1">普通保存已锁定；请在源码模式手动合并后应用合并结果，或采用共享版本。</p>
          {conflictState ? (
            <div className="mt-2 grid gap-2 rounded border border-amber-200/20 bg-black/10 p-2 text-[11px] text-amber-50">
              <div className="flex flex-wrap items-center gap-2">
                <span>共享对照版本 v{conflictState.expectedDocumentVersion}</span>
                {conflictState.newerShared ? (
                  <span className="text-amber-200">
                    已发现较新的共享版本 v{conflictState.newerShared.documentVersion}，请刷新后重新确认。
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void refreshConflictComparison()}
                  className="ui-control rounded border border-amber-100/20 px-2 py-1 text-amber-50"
                >
                  刷新共享对照
                </button>
              </div>
              <pre aria-label="冲突共享版本" className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 font-mono text-[10px] text-slate-200">
                {conflictState.sharedContent}
              </pre>
              <div className="flex flex-wrap items-center gap-2">
                <label>
                  冲突草稿
                  <select
                    aria-label="冲突草稿备份"
                    className="ml-1 rounded bg-slate-900 px-1 py-0.5 text-slate-100"
                    value={conflictState.selectedBackupId ?? ''}
                    onChange={(event) => restoreConflictBackup(event.currentTarget.value)}
                  >
                    {conflictState.backups.map((backup) => (
                      <option key={backup.conflictId} value={backup.conflictId} disabled={'unavailable' in backup}>
                        {'content' in backup
                          ? `可恢复草稿 ${backup.conflictId.slice(0, 8)}`
                          : `不可读取草稿 ${backup.conflictId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!conflictState.conflictId || Boolean(conflictState.newerShared)}
                  onClick={() => void applyConflictMerge()}
                  className="ui-primary-button rounded bg-amber-100 px-2 py-1 font-medium text-slate-900 disabled:opacity-45"
                >
                  应用合并结果
                </button>
                <button
                  type="button"
                  disabled={!conflictState.conflictId}
                  onClick={() => void adoptSharedConflict()}
                  className="ui-control rounded border border-amber-100/20 px-2 py-1 text-amber-50 disabled:opacity-45"
                >
                  保留备份并采用共享版本
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {viewState.viewMode === 'source' ? (
          <div className="relative h-full min-h-0 overflow-hidden">
            <CodeMirror
              key={sourceEditorKey}
              ref={sourceEditorRef}
              aria-label="Markdown 源码编辑器"
              value={sourceInitialValueRef.current}
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
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        className="hidden"
        onChange={handleImageInputChange}
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
