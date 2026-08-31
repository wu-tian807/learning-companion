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
import { registerWorkbenchAnchorController } from '../../renderer/workbench/host/workbench-anchor-bridge';
import { SelectionFloatBar } from './conversation/SelectionFloatBar';
import {
  createHtmlConversationContribution,
  shouldClearHtmlConversationHighlight,
} from './conversation/html-conversation-contribution';
import {
  createAnchorClearCommand,
  createAnchorHighlightCommand,
  isHtmlAnchorTarget,
  isHtmlAnchorCommandResult,
  isSameHtmlAnchorLocation,
  type HtmlAnchorTarget,
} from './anchor-commands';
import { mapHtmlWorkbenchFacilityEvent } from './facility-events';
import { createHtmlRendererActions } from './renderer-actions';
import {
  htmlFrameCommands,
  htmlEditCommands,
  isHtmlDraftReview,
  isHtmlDomTarget,
  isHtmlEditingStatus,
  type HtmlDraftReview,
  htmlWorkbenchManifest,
  isHtmlWorkbenchPayload,
} from './shared';
import { isHtmlSourceCopyInstallResult } from './html-source-copy-frame-script';
import { HtmlDraftToolbar } from './editing/HtmlDraftToolbar';
import {
  htmlEditVisualCommands,
  isHtmlEditVisualResult,
} from './editing/html-edit-visual-commands';
import { HtmlEditReloadQueue } from './editing/html-edit-reload-queue';

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
  const editReloadQueueRef = useRef<HtmlEditReloadQueue | undefined>(
    undefined,
  );
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
  const highlightTargetRef = useRef<HtmlAnchorTarget | undefined>(undefined);
  const highlightRevisionRef = useRef(0);
  const [editingStatus, setEditingStatus] = useState(payload?.editing);
  const [editCommandBusy, setEditCommandBusy] = useState(false);
  const [draftReview, setDraftReview] = useState<HtmlDraftReview>();
  const editingStatusRequestRef = useRef(0);
  const editVisualRevisionRef = useRef(0);
  const appliedEditRevisionsRef = useRef(new Set<string>());
  const frameKey = payload
    ? `${payload.contentUrl}:${frameRevision}`
    : 'invalid';

  const clearHighlight = useCallback(() => {
    const target = highlightTargetRef.current;
    if (!target) return;
    highlightTargetRef.current = undefined;
    const revision = ++highlightRevisionRef.current;
    void executeCommand(createAnchorClearCommand(target, revision)).catch(
      () => undefined,
    );
  }, [executeCommand]);

  const showHighlight = useCallback(
    (
      target: HtmlAnchorTarget,
      options: { readonly reveal: boolean; readonly durationMs: number },
    ): Promise<void> => {
      highlightTargetRef.current = target;
      const revision = ++highlightRevisionRef.current;
      return executeCommand(
        createAnchorHighlightCommand(
          target,
          revision,
          options.reveal,
          options.durationMs,
        ),
      ).then((result) => {
        if (!isHtmlAnchorCommandResult(result.payload)) {
          throw new Error('HTML anchor command returned invalid data');
        }
        if (revision !== highlightRevisionRef.current) return;
        if (!result.payload.found) {
          throw new Error('原文内容可能已经变化，无法定位该锚点。');
        }
      });
    },
    [executeCommand],
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

  const reportAnchorError = useCallback(
    (error: unknown) => {
      reportError(error, '无法在 HTML 原文中定位该锚点。');
    },
    [reportError],
  );

  const conversationOwnerId = `${htmlWorkbenchManifest.id}:${bootstrap.sessionId}`;
  const conversationContribution = useMemo(
    () => createHtmlConversationContribution({
      onContextReleased: releaseConversationContext,
    }),
    [releaseConversationContext],
  );
  const conversationRuntime = useWorkbenchConversationContribution(
    conversationOwnerId,
    asset.id,
    conversationContribution,
    loadedFrameKey === frameKey,
  );
  const conversationSnapshot = useWorkbenchConversationSnapshot(conversationRuntime);
  const aiBusy = conversationSnapshot.busy;

  useEffect(() => {
    if (loadedFrameKey !== frameKey) return;
    return registerWorkbenchAnchorController(
      `${conversationOwnerId}.anchors`,
      asset.id,
      {
        async reveal(target) {
          if (!isHtmlAnchorTarget(target)) return false;
          await showHighlight(target, { reveal: true, durationMs: 2_800 });
          return true;
        },
      },
    );
  }, [asset.id, conversationOwnerId, frameKey, loadedFrameKey, showHighlight]);

  const explainSelection = useCallback((target: ContentAnchorTarget) => {
    if (isHtmlAnchorTarget(target)) {
      void showHighlight(target, { reveal: false, durationMs: 0 }).catch(
        reportAnchorError,
      );
    }
    setPendingSelection(undefined);
    conversationRuntime.open({
      ownerId: conversationOwnerId,
      context: target as unknown as JsonValue,
    });
  }, [conversationOwnerId, conversationRuntime, reportAnchorError, showHighlight]);

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

  const refreshEditingStatus = useCallback(async () => {
    const request = ++editingStatusRequestRef.current;
    try {
      const result = await executeCommand({ type: htmlEditCommands.status });
      if (!isHtmlEditingStatus(result.payload)) {
        throw new Error('HTML editing status returned invalid data');
      }
      if (request === editingStatusRequestRef.current) {
        setEditingStatus(result.payload);
      }
    } catch (error) {
      if (request === editingStatusRequestRef.current) {
        reportError(error, '无法刷新 HTML 草稿状态。');
      }
    }
  }, [executeCommand, reportError]);

  const acceptEditingStatus = useCallback((value: JsonValue) => {
    if (isHtmlEditingStatus(value)) {
      editingStatusRequestRef.current += 1;
      setEditingStatus(value);
      return;
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      const record = value as Readonly<Record<string, JsonValue>>;
      if (isHtmlEditingStatus(record.status)) {
        editingStatusRequestRef.current += 1;
        setEditingStatus(record.status);
      }
    }
  }, []);

  const runEditCommand = useCallback(async (type: string) => {
    setEditCommandBusy(true);
    try {
      const result = await executeCommand({ type });
      acceptEditingStatus(result.payload);
      if (type === htmlEditCommands.discard) setDraftReview(undefined);
    } catch (error) {
      reportError(error, '无法执行 HTML 草稿操作。');
    } finally {
      setEditCommandBusy(false);
    }
  }, [acceptEditingStatus, executeCommand, reportError]);

  const openDraftReview = useCallback(async () => {
    setEditCommandBusy(true);
    try {
      const result = await executeCommand({ type: htmlEditCommands.review });
      if (!isHtmlDraftReview(result.payload)) {
        throw new Error('HTML draft review returned invalid data');
      }
      setDraftReview(result.payload);
    } catch (error) {
      reportError(error, '无法读取 HTML 草稿更改。');
    } finally {
      setEditCommandBusy(false);
    }
  }, [executeCommand, reportError]);

  const showEditVisual = useCallback(
    (
      target: Parameters<typeof isHtmlDomTarget>[0],
      phase: 'scanning' | 'rejected',
    ) => {
      if (!isHtmlDomTarget(target)) return;
      const revision = ++editVisualRevisionRef.current;
      void executeCommand({
        type: htmlEditVisualCommands.show,
        payload: { target, revision, phase },
      }).then(
        (result) => {
          if (!isHtmlEditVisualResult(result.payload)) {
            reportError(
              new Error('HTML edit visual returned invalid data'),
              '无法显示 HTML 修改状态。',
            );
            return;
          }
          if (!result.payload.found) {
            onError('无法在页面中显示正在修改的区域。');
          }
        },
        (error: unknown) => {
          reportError(error, '无法显示 HTML 修改状态。');
        },
      );
    },
    [executeCommand, onError, reportError],
  );

  const clearEditVisual = useCallback((target: JsonValue) => {
    if (!isHtmlDomTarget(target)) return;
    const revision = ++editVisualRevisionRef.current;
    void executeCommand({
      type: htmlEditVisualCommands.clear,
      payload: { target, revision },
    }).then(
      (result) => {
        if (!isHtmlEditVisualResult(result.payload)) {
          reportError(
            new Error('HTML edit visual returned invalid data'),
            '无法清除 HTML 修改状态。',
          );
        }
      },
      (error: unknown) => {
        reportError(error, '无法清除 HTML 修改状态。');
      },
    );
  }, [executeCommand, reportError]);

  useEffect(() => {
    const queue = new HtmlEditReloadQueue();
    editReloadQueueRef.current = queue;
    return () => {
      queue.dispose();
      if (editReloadQueueRef.current === queue) {
        editReloadQueueRef.current = undefined;
      }
    };
  }, [payload?.contentUrl]);

  useEffect(() => {
    if (!subscribeEvent || !payload?.editing) return;

    const unsubscribe = subscribeEvent((event) => {
      const eventPayload = event.payload;
      if (
        typeof eventPayload !== 'object' ||
        eventPayload === null ||
        Array.isArray(eventPayload)
      ) {
        return;
      }
      const record = eventPayload as Record<string, JsonValue>;

      if (
        event.type === 'html.agent-edit.started' ||
        event.type === 'html.agent-edit.rejected'
      ) {
        if (
          typeof record.taskId !== 'string' ||
          typeof record.editId !== 'string' ||
          !isHtmlDomTarget(record.target) ||
          (event.type === 'html.agent-edit.rejected' &&
            typeof record.reason !== 'string')
        ) {
          return;
        }
        showEditVisual(
          record.target,
          event.type === 'html.agent-edit.started' ? 'scanning' : 'rejected',
        );
        return;
      }

      if (event.type === 'html.agent-edit.applied') {
        if (
          typeof record.taskId !== 'string' ||
          typeof record.editId !== 'string' ||
          typeof record.draftRevision !== 'string' ||
          !isHtmlDomTarget(record.target)
        ) {
          return;
        }
        const appliedKey = `${record.editId}\0${record.draftRevision}`;
        if (appliedEditRevisionsRef.current.has(appliedKey)) return;
        appliedEditRevisionsRef.current.add(appliedKey);
        editReloadQueueRef.current?.enqueue(reload);
        void refreshEditingStatus();
        return;
      }

      if (event.type === 'html.agent-edit.ended') {
        if (
          typeof record.taskId !== 'string' ||
          typeof record.editId !== 'string' ||
          !isHtmlDomTarget(record.target)
        ) {
          return;
        }
        clearEditVisual(record.target);
        return;
      }

      if (event.type === 'html.agent-edit.session-changed') {
        const reason = record.reason;
        if (
          reason !== 'settle' &&
          reason !== 'rollback' &&
          reason !== 'undo' &&
          reason !== 'redo' &&
          reason !== 'sync' &&
          reason !== 'discard' &&
          reason !== 'conflict'
        ) {
          return;
        }
        if (
          reason === 'rollback' ||
          reason === 'undo' ||
          reason === 'redo' ||
          reason === 'discard'
        ) {
          editReloadQueueRef.current?.enqueue(reload);
        }
        void refreshEditingStatus();
      }
    });
    void refreshEditingStatus();
    return unsubscribe;
  }, [
    payload?.editing,
    clearEditVisual,
    refreshEditingStatus,
    reload,
    showEditVisual,
    subscribeEvent,
  ]);

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
          void showHighlight(focusTarget, {
            reveal: false,
            durationMs: 0,
          }).catch(reportAnchorError);
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
    reportAnchorError,
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
    setDraftReview(undefined);
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
            .then(() => {
              setLoadedFrameKey(frameKey);
            })
            .catch((error) => {
              reportError(error, '无法启用 HTML 公式源码复制。');
            })
            .finally(() => {
              editReloadQueueRef.current?.complete();
            });
        }}
        onError={() => {
          setFrameFailed(true);
          setLoadedFrameKey(undefined);
          editReloadQueueRef.current?.complete();
        }}
      />

      {editingStatus && (
        <HtmlDraftToolbar
          status={editingStatus}
          busy={editCommandBusy}
          agentBusy={aiBusy}
          review={draftReview}
          onUndo={() => runEditCommand(htmlEditCommands.undo)}
          onRedo={() => runEditCommand(htmlEditCommands.redo)}
          onReview={openDraftReview}
          onSync={() => runEditCommand(htmlEditCommands.sync)}
          onDiscard={() => runEditCommand(htmlEditCommands.discard)}
          onCloseReview={() => setDraftReview(undefined)}
        />
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
