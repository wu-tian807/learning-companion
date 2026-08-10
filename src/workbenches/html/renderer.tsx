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
import { ConversationOverlay } from './conversation/ConversationOverlay';
import { AnchorHighlight } from './conversation/AnchorHighlight';
import { SelectionFloatBar } from './conversation/SelectionFloatBar';
import { createHtmlConversationStore } from './conversation/conversation-store';
import { mapHtmlWorkbenchFacilityEvent } from './facility-events';
import { createHtmlRendererActions } from './renderer-actions';
import {
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
  const [aiAnchor, setAiAnchor] = useState<JsonValue>();
  const [aiSessionKey, setAiSessionKey] = useState(0);
  const [selectionText, setSelectionText] = useState<string>();
  const [selectionRect, setSelectionRect] = useState<
    { x: number; y: number; width: number; height: number } | undefined
  >();
  const [highlightTarget, setHighlightTarget] = useState<
    { readonly anchorType?: string; readonly anchorPayload?: unknown } | undefined
  >();
  const [highlightPersistent, setHighlightPersistent] = useState(false);
  const [highlightKey, setHighlightKey] = useState(0);
  const frameKey = payload
    ? `${payload.contentUrl}:${frameRevision}`
    : 'invalid';

  const openAi = useCallback((anchor?: JsonValue) => {
    // 只有初次打开（从关闭 → 打开）才递增 key 重建为新对话；
    // 对话栏已打开时仅更新锚点（保持当前对话，右键/选中新元素只换 pendingAnchor）。
    setAiOpen((currentlyOpen) => {
      if (!currentlyOpen) {
        setAiSessionKey((current) => current + 1);
      }
      return true;
    });
    setAiAnchor(anchor);
    runtime.htmlAiOverlay.getState().openOverlay();
  }, [runtime]);
  const closeAi = useCallback(() => {
    setAiOpen(false);
    setAiAnchor(undefined);
    setSelectionText(undefined);
    // 切出对话：清除持久锚点红框
    setHighlightTarget(undefined);
    setHighlightPersistent(false);
    runtime.htmlAiOverlay.getState().closeOverlay();
  }, [runtime]);

  useEffect(() => {
    return () => {
      runtime.htmlAiOverlay.getState().closeOverlay();
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
    async (question: string, anchor?: JsonValue) => {
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
            question,
            ...(anchor ? { anchor } : {}),
          },
          assetReferences: {
            sources: [{ assetId: asset.id }],
          },
        });
        return started.id;
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

  const reload = useCallback(() => {
    contextRef.current = undefined;
    onInteractionChange({ inputs: [] });
    setLoadedFrameKey(undefined);
    setFrameFailed(false);
    setFrameRevision((current) => current + 1);
  }, [onInteractionChange]);

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
        onExplainSelection: () => {
          const anchor = contextRef.current?.target;
          openAi(anchor as JsonValue | undefined);
        },
        onSummarizePage: () => {
          const anchor = contextRef.current?.target;
          openAi(anchor as JsonValue | undefined);
        },
        onOpenChat: () => {
          // 总入口：优先带当前选区锚点，无选区则打开空白对话
          const anchor = contextRef.current?.target;
          openAi(anchor as JsonValue | undefined);
        },
      }),
    [onOpenExternal, openAi, reload, reportError, reveal],
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
          // 有选区文本时显示「解释选中内容」悬浮条（锚点携带 frame 内 rect）
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
        if (focusTarget && focusTarget.scope === 'content') {
          setHighlightTarget({
            anchorType: focusTarget.anchorType,
            anchorPayload: focusTarget.anchorPayload,
          });
          setHighlightPersistent(true);
          setHighlightKey((current) => current + 1);
        } else {
          setHighlightTarget(undefined);
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
    onInteractionChange,
    payload,
    runtime,
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
        setHighlightTarget(undefined);
        setHighlightPersistent(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  useEffect(() => {
    contextRef.current = undefined;
    onInteractionChange({ inputs: [] });
    setLoadedFrameKey(undefined);
    setFrameFailed(false);
  }, [onInteractionChange, payload?.contentUrl]);

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
        anchor={aiAnchor}
        store={conversationStore}
        onClose={closeAi}
        onAsk={startAssistantTask}
        onPersistenceError={(error) => {
          reportError(error, '无法保存 HTML AI 对话记录。');
        }}
        onRestore={() => {
          // 历史对话打开不显示选中对象：选中红框只存在于「当前对话引用未发送」阶段。
          setHighlightTarget(undefined);
          setHighlightPersistent(false);
        }}
        onAnchorConsumed={() => {
          // 锚点已随消息发送：选中红框生命周期结束。
          setAiAnchor(undefined);
          setHighlightTarget(undefined);
          setHighlightPersistent(false);
        }}
        onAnchorRemoved={() => {
          // 锚点被主动删除：清除红框。
          setAiAnchor(undefined);
          setHighlightTarget(undefined);
          setHighlightPersistent(false);
        }}
        onStartNew={() => {
          // 主动开启新对话：重置为空白对话（清空红框）。
          setAiAnchor(undefined);
          setHighlightTarget(undefined);
          setHighlightPersistent(false);
          setAiSessionKey((current) => current + 1);
        }}
      />
      <AnchorHighlight
        key={highlightKey}
        target={highlightTarget as never}
        durationMs={highlightPersistent ? 0 : 2_800}
      />

      {/* 选中文本后的「解释选中内容」悬浮条 */}
      {selectionText && !aiOpen && (
        <SelectionFloatBar
          text={selectionText}
          rect={selectionRect}
          onExplain={(text) => {
            setSelectionText(undefined);
            openAi({
              scope: 'content',
              anchorType: 'html.quote',
              anchorVersion: 1,
              anchorPayload: {
                exact: text,
                ...(selectionRect ? { rect: selectionRect } : {}),
              },
            });
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
