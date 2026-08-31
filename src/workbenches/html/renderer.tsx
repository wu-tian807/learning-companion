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
  htmlWorkbenchManifest,
  isHtmlWorkbenchPayload,
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
  const highlightTargetRef = useRef<HtmlAnchorTarget | undefined>(undefined);
  const highlightRevisionRef = useRef(0);
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
            });
        }}
        onError={() => {
          setFrameFailed(true);
          setLoadedFrameKey(undefined);
        }}
      />

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
