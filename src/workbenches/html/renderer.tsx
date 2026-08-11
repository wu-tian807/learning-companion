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
import { useWorkbenchContributions } from '../../renderer/workbench/runtime/use-workbench-contributions';
import { useWorkbenchRuntime } from '../../renderer/workbench/runtime/workbench-runtime-context';
import { useWorkbenchRuntimeSelector } from '../../renderer/workbench/runtime/workbench-runtime-context';
import { userMessageFromError } from '../../shared/ipc-error';
import { findTextSelectionInput } from '../../shared/workbench/selection';
import {
  HTML_ASSISTANT_INSTRUCTION_FORMAT,
  HTML_ASSISTANT_INSTRUCTION_VERSION,
  HTML_ASSISTANT_TASK_DEFINITION_ID,
  HTML_ASSISTANT_TASK_DEFINITION_VERSION,
} from '../../shared/generation-definitions';
import type { CoreContextMenuFacilityEvent } from '../../shared/workbench/facilities/core-facilities';
import type { JsonValue } from '../../shared/workbench/protocol';
import type { ContentAnchorTarget } from '../../shared/workbench/anchor';
import { ConversationOverlay } from './conversation/ConversationOverlay';
import { AnchorHighlight } from './conversation/AnchorHighlight';
import { SelectionFloatBar } from './conversation/SelectionFloatBar';
import {
  createExplainSelectionRequest,
  createOpenChatRequest,
  createSummarizePageRequest,
  type HtmlAiLaunchRequest,
} from './conversation/html-ai-launch';
import { createHtmlConversationStore } from './conversation/conversation-store';
import {
  isHtmlAnchorTarget,
  type HtmlAnchorTarget,
} from './anchor-commands';
import { mapHtmlWorkbenchFacilityEvent } from './facility-events';
import { createHtmlRendererActions } from './renderer-actions';
import {
  createHtmlQuoteTarget,
  htmlWorkbenchManifest,
  isHtmlWorkbenchPayload,
} from './shared';

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
  const identity = useWorkbenchRuntimeSelector(
    (state) => state.identity,
  );
  const projectId = identity?.projectId;
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
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSessionKey, setAiSessionKey] = useState(0);
  const [aiLaunchRequest, setAiLaunchRequest] = useState<HtmlAiLaunchRequest>();
  const launchRequestIdRef = useRef(0);
  /** 当前进行中的任务 ID（cancelAnswer 用；终态时由 onAnswerSettled 同步清除）。 */
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const [aiBusy, setAiBusyState] = useState(false);
  const setAiBusy = useCallback((busy: boolean) => {
    setAiBusyState(busy);
  }, []);
  const [selectionText, setSelectionText] = useState<string>();
  const [selectionRect, setSelectionRect] = useState<
    { x: number; y: number; width: number; height: number } | undefined
  >();
  const [highlightTarget, setHighlightTarget] =
    useState<HtmlAnchorTarget>();
  const [highlightReveal, setHighlightReveal] = useState(false);
  const [highlightDurationMs, setHighlightDurationMs] = useState(0);
  const [highlightRevision, setHighlightRevision] = useState(0);
  const frameKey = payload
    ? `${payload.contentUrl}:${frameRevision}`
    : 'invalid';

  const clearHighlight = useCallback(() => {
    setHighlightTarget(undefined);
    setHighlightReveal(false);
    setHighlightDurationMs(0);
  }, []);

  const showHighlight = useCallback(
    (
      target: HtmlAnchorTarget,
      options: { readonly reveal: boolean; readonly durationMs: number },
    ) => {
      setHighlightTarget(target);
      setHighlightReveal(options.reveal);
      setHighlightDurationMs(options.durationMs);
      setHighlightRevision((current) => current + 1);
    },
    [],
  );

  /** 打开 AI 对话栏并交给 Overlay 一个启动请求（open-chat / explain-selection / summarize-page）。 */
  const launchAi = useCallback((request: HtmlAiLaunchRequest) => {
    setAiOpen((currentlyOpen) => {
      if (!currentlyOpen) {
        setAiSessionKey((current) => current + 1);
      }
      return true;
    });
    setAiLaunchRequest(request);
    runtime.workbenchPanel.getState().openPanel();
  }, [runtime]);

  const openChat = useCallback((anchor?: JsonValue) => {
    launchRequestIdRef.current += 1;
    // 普通打开对话：不自动提交，可携带当前焦点锚点。
    launchAi(createOpenChatRequest(launchRequestIdRef.current, anchor));
  }, [launchAi]);

  const explainSelection = useCallback((target: ContentAnchorTarget) => {
    launchRequestIdRef.current += 1;
    if (isHtmlAnchorTarget(target)) {
      // 当前引用常驻，但不改变用户刚刚选中的滚动位置。
      showHighlight(target, { reveal: false, durationMs: 0 });
    }
    // 关闭悬浮选区条，避免对话打开后旧浮条残留。
    setSelectionText(undefined);
    setSelectionRect(undefined);
    launchAi(
      createExplainSelectionRequest(
        launchRequestIdRef.current,
        target as unknown as JsonValue,
      ),
    );
  }, [launchAi, showHighlight]);

  const summarizePage = useCallback(() => {
    launchRequestIdRef.current += 1;
    // 总结整页：明确忽略当前选区、右键元素与链接。
    setSelectionText(undefined);
    setSelectionRect(undefined);
    clearHighlight();
    launchAi(createSummarizePageRequest(launchRequestIdRef.current));
  }, [clearHighlight, launchAi]);

  const closeAi = useCallback(() => {
    setAiOpen(false);
    setAiLaunchRequest(undefined);
    setSelectionText(undefined);
    // 切出对话：清除持久锚点红框
    clearHighlight();
    runtime.workbenchPanel.getState().closePanel();
  }, [clearHighlight, runtime]);

  const handleLaunchConsumed = useCallback((requestId: number) => {
    setAiLaunchRequest((current) =>
      current?.id === requestId ? undefined : current,
    );
  }, []);

  useEffect(() => {
    return () => {
      runtime.workbenchPanel.getState().closePanel();
    };
  }, [runtime]);

  const conversationStore = useMemo(
    () =>
      createHtmlConversationStore({
        executeCommand: (command) => executeCommand(command),
      }),
    [executeCommand],
  );

  const startAssistantTask = useCallback(
    async (
      conversationId: string,
      question: string,
      anchor?: JsonValue,
    ) => {
      try {
        if (!projectId) {
          throw new Error('Project 上下文缺失');
        }
        const started = await window.learningCompanion.startGenerationTask({
          projectId,
          definitionId: HTML_ASSISTANT_TASK_DEFINITION_ID,
          definitionVersion: HTML_ASSISTANT_TASK_DEFINITION_VERSION,
          instruction: {
            format: HTML_ASSISTANT_INSTRUCTION_FORMAT,
            version: HTML_ASSISTANT_INSTRUCTION_VERSION,
            conversationId,
            question,
            ...(anchor ? { anchor } : {}),
          },
          assetReferences: {
            sources: [{ assetId: asset.id }],
          },
        });
        activeTaskIdRef.current = started.id;

        // 竞态校准：start IPC 返回可能晚于快 task 完成广播（mock / 缓存恢复 /
        // 快速 Provider）。start 返回后立即读取一次权威快照，随结果返回；
        // controller 据此落定终态，不依赖已错过的广播事件。
        try {
          const latest = await window.learningCompanion.getGenerationTask({
            projectId,
            taskId: started.id,
          });
          return {
            taskId: started.id,
            snapshot: latest,
          };
        } catch {
          return { taskId: started.id };
        }
      } catch (error) {
        const message = userMessageFromError(
          error,
          '无法发起 AI 对话。',
        );
        if (message) {
          console.error(message, error);
          onError(message);
        }
        return undefined;
      }
    },
    [asset.id, onError, projectId],
  );

  /** 重跑失败的 GenerationTask：保留原 instruction 与 conversationId，
   * 复用与 start 相同的竞态校准（返回任务 id + 权威快照）。 */
  const retryAssistantTask = useCallback(
    async (taskId: string) => {
      try {
        if (!projectId) {
          throw new Error('Project 上下文缺失');
        }
        const retried = await window.learningCompanion.retryGenerationTask({
          projectId,
          taskId,
        });
        activeTaskIdRef.current = retried.id;
        try {
          const latest = await window.learningCompanion.getGenerationTask({
            projectId,
            taskId: retried.id,
          });
          return {
            taskId: retried.id,
            snapshot: latest,
          };
        } catch {
          return { taskId: retried.id };
        }
      } catch (error) {
        const message = userMessageFromError(error, '无法重试 AI 对话。');
        if (message) {
          console.error(message, error);
          onError(message);
        }
        return undefined;
      }
    },
    [onError, projectId],
  );

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
    },
    [onError, showHighlight],
  );

  const reportAnchorNotFound = useCallback(() => {
    onError('原文内容可能已经变化，无法定位该锚点。');
  }, [onError]);

  const reportAnchorError = useCallback(
    (error: unknown) => {
      reportError(error, '无法在 HTML 原文中定位该锚点。');
    },
    [reportError],
  );

  /** 一次回答终态时同步清除进行中任务引用（取消按钮据此不再瞄准已结束任务）。 */
  const handleAnswerSettled = useCallback((taskId: string) => {
    if (activeTaskIdRef.current === taskId) {
      activeTaskIdRef.current = undefined;
    }
  }, []);

  const cancelAnswer = useCallback(async (taskId: string) => {
    // 校验取消目标仍为进行中任务；task-completed 广播与停止点击的竞态下，
    // 按钮可能持有已结束/已释放的任务引用（service 侧会抛 DATA_INTEGRITY_ERROR）。
    if (activeTaskIdRef.current !== taskId || !projectId) {
      return;
    }
    try {
      await window.learningCompanion.cancelGenerationTask({
        projectId,
        taskId,
      });
    } catch (error) {
      reportError(error, '无法停止 AI 回答。');
    }
  }, [projectId, reportError]);

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
        onOpenChat: () => {
          // 总入口：优先带当前选区锚点，无选区则打开空白对话
          const anchor = contextRef.current?.target;
          openChat(anchor as JsonValue | undefined);
        },
      }),
    [aiBusy, explainSelection, onOpenExternal, openChat, reload, reportError, reveal, summarizePage],
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
          onInteractionChange(mapped.interaction);
          // 有选区文本时显示「引用选中内容」悬浮条（锚点携带 frame 内 rect）
          const selection = findTextSelectionInput(mapped.interaction);
          const payload =
            selection?.target &&
            selection.target.scope === 'content' &&
            selection.target.anchorType === 'html.quote'
              ? (selection.target.anchorPayload as {
                  readonly rect?: {
                    readonly x: number;
                    readonly y: number;
                    readonly width: number;
                    readonly height: number;
                  };
                } | undefined)
              : undefined;
          setSelectionText(selection?.text);
          setSelectionRect(payload?.rect);
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
      const overlay = document.querySelector('[role="dialog"][aria-label="AI 对话"]');
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
          setLoadedFrameKey(frameKey);
        }}
        onError={() => {
          setFrameFailed(true);
          setLoadedFrameKey(undefined);
        }}
      />

      <ConversationOverlay
        key={aiSessionKey}
        open={aiOpen}
        launchRequest={aiLaunchRequest}
        onLaunchConsumed={handleLaunchConsumed}
        store={conversationStore}
        onClose={closeAi}
        onAsk={startAssistantTask}
        onGetTask={async (taskId) => {
          if (!projectId) {
            return undefined;
          }
          return window.learningCompanion.getGenerationTask({
            projectId,
            taskId,
          });
        }}
        onTaskActivated={(taskId) => {
          activeTaskIdRef.current = taskId;
        }}
        onRetryTask={retryAssistantTask}
        onBusyChange={setAiBusy}
        onAnswerSettled={handleAnswerSettled}
        onCancelAnswer={(taskId) => {
          void cancelAnswer(taskId);
        }}
        onPersistenceError={(error) => {
          reportError(error, '无法保存 HTML AI 对话记录。');
        }}
        onRestore={() => {
          clearHighlight();
        }}
        onAnchorActivate={activateConversationAnchor}
        onAnchorConsumed={() => {
          clearHighlight();
        }}
        onAnchorRemoved={() => {
          clearHighlight();
        }}
        onStartNew={() => {
          // 主动开启新对话：重置为空白对话（清空红框）。
          setAiLaunchRequest(undefined);
          clearHighlight();
          setAiSessionKey((current) => current + 1);
        }}
      />
      <AnchorHighlight
        target={highlightTarget}
        revision={highlightRevision}
        reveal={highlightReveal}
        durationMs={highlightDurationMs}
        executeCommand={executeCommand}
        onNotFound={reportAnchorNotFound}
        onError={reportAnchorError}
      />

      {/* 选中文本后的「引用选中内容」悬浮条（对话栏打开时也显示：
          点击后把新选中内容更新到对话栏锚点，而不是被对话栏状态挡住） */}
      {selectionText && (
        <SelectionFloatBar
          text={selectionText}
          rect={selectionRect}
          onExplain={(text) => {
            setSelectionText(undefined);
            explainSelection(
              createHtmlQuoteTarget(
                text,
                payload.contentUrl,
                selectionRect,
              ),
            );
          }}
          onDismiss={() => {
            setSelectionText(undefined);
            setSelectionRect(undefined);
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
