import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  RendererWorkbenchModule,
  RendererWorkbenchViewProps,
} from '../../renderer/workbench/renderer-workbench-registry';
import {
  useWorkbenchConversationContribution,
  useWorkbenchConversationSnapshot,
} from '../../renderer/conversation/workbench-conversation-context';
import { useWorkbenchContributions } from '../../renderer/workbench/runtime/use-workbench-contributions';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
import { userMessageFromError } from '../../shared/ipc-error';
import { findTextSelectionInput } from '../../shared/workbench/selection';
import type {
  CoreContextMenuFacilityEvent,
  CoreViewportRect,
} from '../../shared/workbench/facilities/core-facilities';
import type { JsonValue } from '../../shared/workbench/protocol';
import type { ContentAnchorTarget } from '../../shared/workbench/anchor';
import { AnchorHighlight } from './conversation/AnchorHighlight';
import { SelectionFloatBar } from './conversation/SelectionFloatBar';
import { HtmlEditIndicator } from './editing/HtmlEditIndicator';
import {
  createHtmlConversationContribution,
  shouldClearHtmlConversationHighlight,
} from './conversation/html-conversation-contribution';
import {
  isHtmlAnchorTarget,
  isSameHtmlAnchorLocation,
  type HtmlAnchorTarget,
} from './anchor-commands';
import { mapHtmlWorkbenchFacilityEvent } from './facility-events';
import { createHtmlRendererActions } from './renderer-actions';
import {
  HtmlEditReloadQueue,
  shouldRefreshHtmlDraftPreview,
  staleHistoricalAnchorMessage,
} from './html-edit-renderer-state';
import {
  htmlFrameCommands,
  htmlEditCommands,
  htmlEditEvents,
  htmlWorkbenchManifest,
  isHtmlEditingStatus,
  isHtmlDomTarget,
  isHtmlWorkbenchPayload,
  type HtmlEditingStatus,
} from './shared';
import { isHtmlSourceCopyInstallResult } from './html-source-copy-frame-script';

export async function installHtmlSourceCopyInFrame(
  executeCommand: RendererWorkbenchViewProps['executeCommand'],
): Promise<void> {
  const result = await executeCommand({
    type: htmlFrameCommands.installSourceCopy,
  });
  if (!isHtmlSourceCopyInstallResult(result.payload)) {
    throw new Error('HTML source-copy installer returned invalid data');
  }
}

export const HTML_DOCUMENT_SANDBOX = [
  'allow-forms',
  'allow-modals',
  'allow-pointer-lock',
  'allow-popups',
  'allow-scripts',
].join(' ');

interface HtmlDocumentFrameProps {
  readonly contentUrl: string;
  readonly title: string;
  readonly frameKey?: string;
  readonly onLoad?: () => void;
  readonly onError?: () => void;
}

interface PendingHtmlTextSelection {
  readonly text: string;
  readonly target: HtmlAnchorTarget;
  readonly rect?: CoreViewportRect;
}

type HtmlEditPhase = 'idle' | 'editing' | 'refreshing' | 'rejected';

interface HtmlDraftStatusPresentation {
  readonly title: string;
  readonly detail: string;
  readonly tone: 'amber' | 'emerald' | 'rose';
}

function htmlDraftStatusPresentation(
  status: HtmlEditingStatus,
  phase: HtmlEditPhase,
): HtmlDraftStatusPresentation {
  if (phase === 'editing') {
    return {
      title: 'AI 正在编辑草稿',
      detail: '已锁定修改区域',
      tone: 'amber',
    };
  }
  if (phase === 'refreshing') {
    return {
      title: '正在刷新草稿预览',
      detail: '载入最新修改',
      tone: 'amber',
    };
  }
  if (phase === 'rejected') {
    return {
      title: '本次替换未通过校验',
      detail: '草稿内容未发生变化',
      tone: 'rose',
    };
  }
  if (status.conflict) {
    return {
      title: '草稿与原文件存在冲突',
      detail: '同步前需要处理冲突',
      tone: 'rose',
    };
  }
  if (status.syncRequested) {
    return {
      title: '等待本轮完成后同步',
      detail: `${status.stepCount} 轮 · ${status.changeCount} 处更改`,
      tone: 'amber',
    };
  }
  if (status.unsynced) {
    return {
      title: '草稿待同步',
      detail: `${status.stepCount} 轮 · ${status.changeCount} 处更改`,
      tone: 'amber',
    };
  }
  return {
    title: '草稿已同步',
    detail: '当前预览与原文件一致',
    tone: 'emerald',
  };
}

function DraftIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 2.75h6.2L15 6.55v10.7H5z" />
      <path d="M11 2.75v4h4M7.5 10h5M7.5 13h3.5" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m7 6-3 3 3 3" />
      <path d="M4.5 9H12a4 4 0 0 1 0 8H9" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m13 6 3 3-3 3" />
      <path d="M15.5 9H8a4 4 0 0 0 0 8h3" />
    </svg>
  );
}

function ReviewIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4.5h14v11H3zM10 4.5v11" />
      <path d="M5.5 8h2M5.5 11h2M12.5 8h2M12.5 11h2" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15.5 7A6 6 0 0 0 5.2 5.2L3.5 7" />
      <path d="M3.5 3.8V7h3.2M4.5 13a6 6 0 0 0 10.3 1.8l1.7-1.8" />
      <path d="M16.5 16.2V13h-3.2" />
    </svg>
  );
}

function DiscardIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 6h11M8 3.5h4M6 6l.7 10.5h6.6L14 6" />
      <path d="M8.5 9v4.5M11.5 9v4.5" />
    </svg>
  );
}

function isFeatureNotSupportedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'FEATURE_NOT_SUPPORTED'
  );
}

export function pendingHtmlTextSelection(
  interaction: Parameters<typeof findTextSelectionInput>[0],
  rect?: CoreViewportRect,
): PendingHtmlTextSelection | undefined {
  const selection = findTextSelectionInput(interaction);
  if (!selection || !isHtmlAnchorTarget(selection.target)) {
    return undefined;
  }
  return {
    text: selection.text,
    target: selection.target,
    ...(rect === undefined ? {} : { rect }),
  };
}

export function HtmlDocumentFrame({
  contentUrl,
  title,
  frameKey,
  onLoad,
  onError,
}: HtmlDocumentFrameProps) {
  return (
    <iframe
      key={frameKey}
      title={`HTML 原文：${title}`}
      aria-label="HTML 原文沙箱"
      src={contentUrl}
      sandbox={HTML_DOCUMENT_SANDBOX}
      allow="autoplay; fullscreen; gamepad; xr-spatial-tracking"
      referrerPolicy="no-referrer"
      onLoad={onLoad}
      onError={onError}
      className="h-full w-full border-0 bg-white"
    />
  );
}

export function HtmlWorkbenchView({
  asset,
  bootstrap,
  executeCommand,
  subscribeEvent,
  onRelink,
  onRefresh,
  onReveal,
  onInteractionChange,
  onOpenExternal,
  onError,
}: RendererWorkbenchViewProps) {
  const runtime = useWorkbenchRuntime();
  const payload = isHtmlWorkbenchPayload(bootstrap.payload)
    ? bootstrap.payload
    : undefined;
  const contextRef = useRef<
    CoreContextMenuFacilityEvent | undefined
  >(
    undefined,
  );
  const [frameRevision, setFrameRevision] = useState(0);
  const [loadedFrameKey, setLoadedFrameKey] = useState<string>();
  const [frameFailed, setFrameFailed] = useState(false);
  const [pendingSelection, setPendingSelection] =
    useState<PendingHtmlTextSelection>();
  const [highlightTarget, setHighlightTarget] =
    useState<HtmlAnchorTarget>();
  const highlightTargetRef = useRef<HtmlAnchorTarget | undefined>(undefined);
  const [highlightReveal, setHighlightReveal] = useState(false);
  const [highlightDurationMs, setHighlightDurationMs] = useState(0);
  const [highlightRevision, setHighlightRevision] = useState(0);
  const [editingStatus, setEditingStatus] = useState<HtmlEditingStatus | undefined>(
    payload?.editing,
  );
  const [editPhase, setEditPhase] = useState<HtmlEditPhase>('idle');
  const [editIndicatorTarget, setEditIndicatorTarget] =
    useState<HtmlAnchorTarget>();
  const [editIndicatorRevision, setEditIndicatorRevision] = useState(0);
  const [editIndicatorPhase, setEditIndicatorPhase] = useState<
    'editing' | 'rejected'
  >('editing');
  const [editCommandBusy, setEditCommandBusy] = useState(false);
  const [reviewChanges, setReviewChanges] = useState<
    readonly { readonly before: string; readonly after: string }[]
  >();
  const historicalLookupRef = useRef(false);
  const reloadQueueRef = useRef(new HtmlEditReloadQueue());
  const editRejectionTimerRef = useRef<number | undefined>(undefined);
  const previewedDraftRevisionRef = useRef(
    payload?.editing?.draftRevision,
  );
  const previousAiBusyRef = useRef(false);
  const frameKey = payload
    ? `${payload.contentUrl}:${frameRevision}`
    : 'invalid';
  const draftPresentation = editingStatus
    ? htmlDraftStatusPresentation(editingStatus, editPhase)
    : undefined;
  const draftToneClasses = draftPresentation?.tone === 'rose'
    ? 'border-rose-300/20 bg-rose-300/10 text-rose-200'
    : draftPresentation?.tone === 'emerald'
      ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200'
      : 'border-amber-300/20 bg-amber-300/10 text-amber-200';

  const clearHighlight = useCallback(() => {
    historicalLookupRef.current = false;
    highlightTargetRef.current = undefined;
    setHighlightTarget(undefined);
    setHighlightReveal(false);
    setHighlightDurationMs(0);
  }, []);

  const showHighlight = useCallback(
    (
      target: HtmlAnchorTarget,
      options: { readonly reveal: boolean; readonly durationMs: number },
    ) => {
      highlightTargetRef.current = target;
      setHighlightTarget(target);
      setHighlightReveal(options.reveal);
      setHighlightDurationMs(options.durationMs);
      setHighlightRevision((current) => current + 1);
    },
    [],
  );

  const releaseConversationContext = useCallback((context: JsonValue | undefined) => {
    if (
      shouldClearHtmlConversationHighlight(
        context,
        highlightTargetRef.current,
      )
    ) {
      clearHighlight();
    }
  }, [clearHighlight]);

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

  const activateConversationAnchor = useCallback(
    (anchor: JsonValue) => {
      if (!isHtmlAnchorTarget(anchor)) {
        onError('无法在 HTML 原文中定位该锚点。');
        return;
      }
      showHighlight(anchor, { reveal: true, durationMs: 2_800 });
      historicalLookupRef.current = true;
    },
    [onError, showHighlight],
  );

  const reportAnchorNotFound = useCallback(() => {
    const message = staleHistoricalAnchorMessage(
      historicalLookupRef.current,
      false,
    );
    if (message) onError(message);
    historicalLookupRef.current = false;
  }, [onError]);

  const reportAnchorFound = useCallback(() => {
    historicalLookupRef.current = false;
  }, []);

  const reportAnchorError = useCallback(
    (error: unknown) => {
      historicalLookupRef.current = false;
      reportError(error, '无法在 HTML 原文中定位该锚点。');
    },
    [reportError],
  );

  const conversationContribution = useMemo(
    () => createHtmlConversationContribution({
      assetId: asset.id,
      revealContext: activateConversationAnchor,
      onContextReleased: releaseConversationContext,
    }),
    [
      activateConversationAnchor,
      asset.id,
      releaseConversationContext,
    ],
  );
  const conversationOwnerId = `${htmlWorkbenchManifest.id}:${bootstrap.sessionId}`;
  const conversationRuntime = useWorkbenchConversationContribution(
    conversationOwnerId,
    asset.id,
    conversationContribution,
  );
  const conversationSnapshot = useWorkbenchConversationSnapshot(conversationRuntime);
  const aiBusy = conversationSnapshot.busy;

  const explainSelection = useCallback((target: ContentAnchorTarget) => {
    historicalLookupRef.current = false;
    if (isHtmlAnchorTarget(target)) {
      showHighlight(target, { reveal: false, durationMs: 0 });
    }
    setPendingSelection(undefined);
    conversationRuntime.open({
      ownerId: conversationOwnerId,
      context: target as unknown as JsonValue,
    });
  }, [conversationOwnerId, conversationRuntime, showHighlight]);

  const summarizePage = useCallback(() => {
    setPendingSelection(undefined);
    clearHighlight();
    conversationRuntime.open({
      ownerId: conversationOwnerId,
      question:
        '请总结当前 HTML 页面。先概括页面主题和核心结论，再按结构梳理主要内容、关键概念与重要细节；不要只解释当前选区。',
      submit: true,
    });
  }, [clearHighlight, conversationOwnerId, conversationRuntime]);

  const reload = useCallback(() => {
    contextRef.current = undefined;
    clearHighlight();
    onInteractionChange({ inputs: [] });
    setLoadedFrameKey(undefined);
    setFrameFailed(false);
    setFrameRevision((current) => current + 1);
  }, [clearHighlight, onInteractionChange]);

  const queueEditReload = useCallback(() => {
    reloadQueueRef.current.enqueue(() => {
      setEditPhase('refreshing');
      reload();
    });
  }, [reload]);

  const clearEditRejectionTimer = useCallback(() => {
    if (editRejectionTimerRef.current !== undefined) {
      window.clearTimeout(editRejectionTimerRef.current);
      editRejectionTimerRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    const reloadQueue = new HtmlEditReloadQueue();
    reloadQueueRef.current = reloadQueue;

    return () => {
      clearEditRejectionTimer();
      reloadQueue.dispose();
    };
  }, [clearEditRejectionTimer]);

  const refreshEditingStatus = useCallback(async () => {
    const result = await executeCommand({ type: htmlEditCommands.status });
    if (!isHtmlEditingStatus(result.payload)) {
      throw new Error('HTML editing status returned invalid data');
    }
    setEditingStatus(result.payload);
    return result.payload;
  }, [executeCommand]);

  useEffect(() => {
    const wasBusy = previousAiBusyRef.current;
    previousAiBusyRef.current = aiBusy;
    if (!wasBusy || aiBusy) return;

    void refreshEditingStatus()
      .then((status) => {
        if (
          !shouldRefreshHtmlDraftPreview(
            previewedDraftRevisionRef.current,
            status.draftRevision,
          )
        ) {
          return;
        }
        previewedDraftRevisionRef.current = status.draftRevision;
        queueEditReload();
      })
      .catch((error) => {
        if (isFeatureNotSupportedError(error)) return;
        reportError(error, '无法刷新 HTML 草稿状态。');
      });
  }, [aiBusy, queueEditReload, refreshEditingStatus, reportError]);

  const runEditCommand = useCallback(
    async (type: string) => {
      setEditCommandBusy(true);
      try {
        const result = await executeCommand({ type });
        if (type === htmlEditCommands.discard) {
          setEditingStatus(undefined);
        } else if (type !== htmlEditCommands.review) {
          const candidate =
            typeof result.payload === 'object' &&
            result.payload !== null &&
            !Array.isArray(result.payload) &&
            'status' in result.payload
              ? result.payload.status
              : result.payload;
          if (isHtmlEditingStatus(candidate)) setEditingStatus(candidate);
        }
      } catch (error) {
        reportError(error, 'HTML 草稿操作失败。');
      } finally {
        setEditCommandBusy(false);
      }
    },
    [executeCommand, reportError],
  );

  const reviewDraft = useCallback(async () => {
    setEditCommandBusy(true);
    try {
      const result = await executeCommand({ type: htmlEditCommands.review });
      if (
        typeof result.payload !== 'object' ||
        result.payload === null ||
        Array.isArray(result.payload)
      ) {
        throw new Error('HTML edit review returned invalid data');
      }
      const review = result.payload as Readonly<Record<string, JsonValue>>;
      const rows: Array<{ before: string; after: string }> = [];
      const collect = (value: unknown) => {
        if (!Array.isArray(value)) return;
        for (const entry of value) {
          if (
            typeof entry === 'object' &&
            entry !== null &&
            !Array.isArray(entry) &&
            typeof entry.before === 'string' &&
            typeof entry.after === 'string'
          ) {
            rows.push({ before: entry.before, after: entry.after });
          }
        }
      };
      if (Array.isArray(review.entries)) {
        for (const entry of review.entries) {
          if (
            typeof entry === 'object' &&
            entry !== null &&
            !Array.isArray(entry)
          ) {
            collect(entry.changes);
          }
        }
      }
      collect(review.pendingChanges);
      setReviewChanges(rows);
    } catch (error) {
      reportError(error, '无法查看 HTML 草稿更改。');
    } finally {
      setEditCommandBusy(false);
    }
  }, [executeCommand, reportError]);

  const reveal = useCallback(async () => {
    try {
      await onReveal();
    } catch (error) {
      reportError(error, '无法在文件夹中显示 HTML 文件。');
    }
  }, [onReveal, reportError]);

  const rendererActions = useMemo(
    () =>
      createHtmlRendererActions({
        getContext: () => contextRef.current,
        aiBusy,
        onCopySelection: async (text) => {
          try {
            await navigator.clipboard.writeText(text);
          } catch (error) {
            reportError(error, '无法复制 HTML 选中内容。');
          }
        },
        onOpenLink: onOpenExternal,
        onReload: reload,
        onReveal: reveal,
        onExplainSelection: (selection) => {
          explainSelection(selection);
        },
        onSummarizePage: () => {
          summarizePage();
        },
      }),
    [aiBusy, explainSelection, onOpenExternal, reload, reportError, reveal, summarizePage],
  );
  useWorkbenchContributions(
    `${htmlWorkbenchManifest.id}.viewer`,
    rendererActions,
  );

  useEffect(() => {
    if (!subscribeEvent || !payload) return;
    return subscribeEvent((event) => {
      if (!Object.values(htmlEditEvents).includes(event.type as never)) return;
      const eventPayload = event.payload;
      if (
        typeof eventPayload !== 'object' ||
        eventPayload === null ||
        Array.isArray(eventPayload)
      ) {
        return;
      }
      const editEvent = eventPayload as Readonly<Record<string, JsonValue>>;

      if (event.type === htmlEditEvents.started) {
        if (!isHtmlDomTarget(editEvent.target)) return;
        clearEditRejectionTimer();
        setEditIndicatorTarget(editEvent.target);
        setEditIndicatorPhase('editing');
        setEditIndicatorRevision((current) => current + 1);
        setEditPhase('editing');
      } else if (event.type === htmlEditEvents.rejected) {
        if (!isHtmlDomTarget(editEvent.target)) return;
        setEditIndicatorTarget(editEvent.target);
        setEditIndicatorPhase('rejected');
        setEditIndicatorRevision((current) => current + 1);
        setEditPhase('rejected');
        clearEditRejectionTimer();
        editRejectionTimerRef.current = window.setTimeout(() => {
          editRejectionTimerRef.current = undefined;
          setEditPhase('editing');
          setEditIndicatorPhase('editing');
          setEditIndicatorRevision((current) => current + 1);
        }, 1_200);
      } else if (event.type === htmlEditEvents.ended) {
        clearEditRejectionTimer();
        setEditIndicatorTarget(undefined);
        setEditPhase('idle');
      } else if (event.type === htmlEditEvents.applied) {
        if (typeof editEvent.draftRevision !== 'string') return;
        clearEditRejectionTimer();
        setEditIndicatorTarget(undefined);
        previewedDraftRevisionRef.current = editEvent.draftRevision;
        queueEditReload();
      } else {
        clearEditRejectionTimer();
        setEditIndicatorTarget(undefined);
        const reason = editEvent.reason;
        if (reason === 'discard') {
          setEditingStatus(undefined);
        }
        if (reason !== 'sync' && reason !== 'conflict') queueEditReload();
      }
      if (editEvent.reason !== 'discard') {
        void refreshEditingStatus().catch((error) => {
          reportError(error, '无法刷新 HTML 草稿状态。');
        });
      }
    });
  }, [
    payload,
    clearEditRejectionTimer,
    queueEditReload,
    refreshEditingStatus,
    reportError,
    subscribeEvent,
  ]);

  useEffect(() => {
    if (!payload) {
      return;
    }

    return window.learningCompanion.onWorkbenchFacilityEvent(
      (event) => {
        const mapped = mapHtmlWorkbenchFacilityEvent(
          event,
          bootstrap.sessionId,
        );

        if (!mapped) {
          return;
        }

        if (mapped.kind === 'selection') {
          // 有选区文本时显示悬浮条；rect 仅用于本次 UI 定位，不写入 DOM Anchor。
          const selection = pendingHtmlTextSelection(
            mapped.interaction,
            mapped.rect,
          );
          if (
            selection?.target &&
            isSameHtmlAnchorLocation(
              selection.target,
              highlightTargetRef.current,
            )
          ) {
            // Clicking the float bar opens the chat panel, which resizes the
            // iframe. Electron may publish the still-native selection again
            // with a different rect. It is already the active context, so do
            // not resurrect the consumed float bar or generic selection.
            onInteractionChange({ inputs: [] });
            setPendingSelection(undefined);
            return;
          }
          onInteractionChange(mapped.interaction);
          setPendingSelection(selection);
          return;
        }

        contextRef.current = mapped.context;
        onInteractionChange(mapped.interaction);
        // 右键命中元素/文本锚点：进入对话的「待发送锚点」→ 持久显示红框，
        // 直到发送（onAnchorConsumed）或删除（chip ✕）或离开对话。
        const focusTarget = mapped.interaction.focus;
        if (isHtmlAnchorTarget(focusTarget)) {
          showHighlight(focusTarget, {
            reveal: false,
            durationMs: 0,
          });
        } else {
          clearHighlight();
        }
        runtime.openContextMenu(
          bootstrap.sessionId,
          mapped.position,
          mapped.interaction,
          { captureOutsidePointer: true },
        );
      },
    );
  }, [
    bootstrap.sessionId,
    clearHighlight,
    onInteractionChange,
    payload,
    runtime,
    showHighlight,
  ]);

  useEffect(() => {
    // 点击别处（非对话栏、非浮动条）取消当前待发送锚点的红框。
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const overlay = document.querySelector('[role="dialog"][aria-label="AI 问答"]');
      const floatBar = document.querySelector('[role="toolbar"][aria-label="选中内容操作"]');
      if (
        target &&
        !overlay?.contains(target) &&
        !floatBar?.contains(target)
      ) {
        clearHighlight();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [clearHighlight]);

  useEffect(() => {
    contextRef.current = undefined;
    onInteractionChange({ inputs: [] });
    clearHighlight();
    setLoadedFrameKey(undefined);
    setFrameFailed(false);
    setEditingStatus(payload?.editing);
    previewedDraftRevisionRef.current = payload?.editing?.draftRevision;
  }, [clearHighlight, onInteractionChange, payload?.contentUrl]);

  if (!payload) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <p className="text-sm text-rose-300">
          HTML Workbench 数据无效
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-white">
      <HtmlDocumentFrame
        contentUrl={payload.contentUrl}
        title={asset.name}
        frameKey={frameKey}
        onLoad={() => {
          setFrameFailed(false);
          void installHtmlSourceCopyInFrame(executeCommand)
            .catch((error) => {
              reportError(error, '无法启用 HTML 公式源码复制。');
            })
            .finally(() => {
              setLoadedFrameKey(frameKey);
              reloadQueueRef.current.complete();
              setEditPhase('idle');
            });
        }}
        onError={() => {
          setFrameFailed(true);
          setLoadedFrameKey(undefined);
          reloadQueueRef.current.complete();
          setEditPhase('idle');
        }}
      />

      <AnchorHighlight
        target={highlightTarget}
        revision={highlightRevision}
        reveal={highlightReveal}
        durationMs={highlightDurationMs}
        executeCommand={executeCommand}
        onNotFound={reportAnchorNotFound}
        onFound={reportAnchorFound}
        onError={reportAnchorError}
      />

      <HtmlEditIndicator
        target={editIndicatorTarget}
        revision={editIndicatorRevision}
        phase={editIndicatorPhase}
        executeCommand={executeCommand}
      />

      {editingStatus && draftPresentation && (
        <div
          role="toolbar"
          aria-label="HTML 草稿工具栏"
          className="absolute left-3 right-3 top-3 z-20 flex h-12 items-center gap-2 rounded-md border border-white/[0.12] bg-[#171d25]/[0.96] px-2.5 text-slate-200 shadow-[0_14px_36px_rgba(3,7,12,0.34)] backdrop-blur-md"
        >
          <div
            aria-live="polite"
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <span
              className={`relative grid size-8 shrink-0 place-items-center rounded-md border ${draftToneClasses}`}
            >
              <span className="size-[17px]">
                <DraftIcon />
              </span>
              <span
                className={`absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-[#171d25] ${
                  draftPresentation.tone === 'rose'
                    ? 'bg-rose-400'
                    : draftPresentation.tone === 'emerald'
                      ? 'bg-emerald-400'
                      : 'bg-amber-400'
                } ${
                  editPhase === 'editing' || editPhase === 'refreshing'
                    ? 'animate-pulse'
                    : ''
                }`}
              />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold leading-4 text-slate-100">
                {draftPresentation.title}
              </span>
              <span className="block truncate text-[10px] leading-4 text-slate-400">
                {draftPresentation.detail}
              </span>
            </span>
          </div>

          <div
            role="group"
            aria-label="草稿历史操作"
            className="flex shrink-0 items-center gap-0.5 rounded-md border border-white/[0.08] bg-black/15 p-0.5"
          >
            <button
              type="button"
              aria-label="撤销上一轮 AI 修改"
              disabled={!editingStatus.canUndo || editCommandBusy || aiBusy}
              onClick={() => void runEditCommand(htmlEditCommands.undo)}
              className="ui-icon-button grid size-7 place-items-center rounded-md text-slate-400 disabled:cursor-not-allowed disabled:opacity-30"
              title="撤销上一轮 AI 修改"
            >
              <span className="size-4">
                <UndoIcon />
              </span>
            </button>
            <button
              type="button"
              aria-label="重做下一轮 AI 修改"
              disabled={!editingStatus.canRedo || editCommandBusy || aiBusy}
              onClick={() => void runEditCommand(htmlEditCommands.redo)}
              className="ui-icon-button grid size-7 place-items-center rounded-md text-slate-400 disabled:cursor-not-allowed disabled:opacity-30"
              title="重做下一轮 AI 修改"
            >
              <span className="size-4">
                <RedoIcon />
              </span>
            </button>
            <span className="mx-0.5 h-4 w-px bg-white/[0.08]" />
            <button
              type="button"
              aria-label="查看草稿更改"
              disabled={editCommandBusy}
              onClick={() => void reviewDraft()}
              className="ui-icon-button grid size-7 place-items-center rounded-md text-slate-400 disabled:cursor-not-allowed disabled:opacity-30"
              title="查看草稿更改"
            >
              <span className="size-4">
                <ReviewIcon />
              </span>
            </button>
          </div>

          <button
            type="button"
            aria-label="同步草稿到原文件"
            disabled={editCommandBusy || !editingStatus.unsynced}
            onClick={() => void runEditCommand(htmlEditCommands.sync)}
            className="ui-control flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-amber-200/25 bg-amber-300 px-2.5 text-[11px] font-semibold text-slate-950 shadow-[0_6px_18px_rgba(245,158,11,0.2)] hover:!bg-amber-200 hover:!text-slate-950 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.04] disabled:text-slate-500 disabled:shadow-none disabled:opacity-100"
            title="同步草稿到原文件"
          >
            <span className="size-3.5">
              <SyncIcon />
            </span>
            <span>同步</span>
          </button>
          <button
            type="button"
            aria-label="放弃草稿"
            disabled={editCommandBusy || editingStatus.pending || aiBusy}
            onClick={() => void runEditCommand(htmlEditCommands.discard)}
            className="ui-icon-button grid size-8 shrink-0 place-items-center rounded-md text-slate-500 hover:!bg-rose-400/10 hover:!text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
            title="放弃草稿"
          >
            <span className="size-4">
              <DiscardIcon />
            </span>
          </button>
        </div>
      )}

      {reviewChanges && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="HTML 草稿更改"
          className="absolute inset-0 z-30 grid place-items-center bg-black/35 p-6"
        >
          <div className="max-h-[80%] w-full max-w-3xl overflow-auto rounded-md bg-white p-4 text-slate-800 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">草稿更改</h2>
              <button
                type="button"
                onClick={() => setReviewChanges(undefined)}
                className="ui-control px-2 py-1 text-xs"
              >
                关闭
              </button>
            </div>
            {reviewChanges.length === 0 ? (
              <p className="text-xs text-slate-500">当前没有可显示的更改。</p>
            ) : (
              reviewChanges.map((change, index) => (
                <div key={index} className="mb-4 grid gap-2 md:grid-cols-2">
                  <pre className="overflow-auto whitespace-pre-wrap border-l-2 border-rose-300 bg-slate-50 p-2 text-xs">{change.before}</pre>
                  <pre className="overflow-auto whitespace-pre-wrap border-l-2 border-emerald-300 bg-slate-50 p-2 text-xs">{change.after}</pre>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 选中文本后的「引用选中内容」悬浮条（对话栏打开时也显示：
          点击后把新选中内容更新到对话栏锚点，而不是被对话栏状态挡住） */}
      {pendingSelection && (
        <SelectionFloatBar
          text={pendingSelection.text}
          rect={pendingSelection.rect}
          onExplain={() => explainSelection(pendingSelection.target)}
          onDismiss={() => {
            setPendingSelection(undefined);
          }}
        />
      )}

      {loadedFrameKey !== frameKey && !frameFailed && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#151a20]/88">
          <div className="flex items-center gap-2.5 rounded-full border border-white/[0.07] bg-[#20262e]/90 px-4 py-2 text-xs text-slate-400 shadow-xl">
            <span className="size-3 animate-spin rounded-full border border-slate-500 border-t-indigo-200" />
            正在加载 HTML 原文及外部资源…
          </div>
        </div>
      )}

      {frameFailed && (
        <div className="absolute inset-0 grid place-items-center bg-[#151a20]/96 p-8 text-center">
          <div>
            <p className="text-sm font-medium text-slate-200">
              无法打开 HTML 文档
            </p>
            <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">
              原文沙箱没有成功载入，请刷新资料或重新定位文件。
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

const htmlRendererWorkbenchModule: RendererWorkbenchModule<
  typeof htmlWorkbenchManifest.id
> = {
  manifest: htmlWorkbenchManifest,
  View: HtmlWorkbenchView,
};

export default htmlRendererWorkbenchModule;
