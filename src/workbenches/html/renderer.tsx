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
  const [selectionText, setSelectionText] = useState<string>();
  const [highlightTarget, setHighlightTarget] = useState<
    { readonly anchorType?: string; readonly anchorPayload?: unknown } | undefined
  >();
  const frameKey = payload
    ? `${payload.contentUrl}:${frameRevision}`
    : 'invalid';

  const openAi = useCallback((anchor?: JsonValue) => {
    setAiAnchor(anchor);
    setAiOpen(true);
  }, []);
  const closeAi = useCallback(() => {
    setAiOpen(false);
    setAiAnchor(undefined);
    setSelectionText(undefined);
  }, []);

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
          // 有选区文本时显示「解释选中内容」悬浮条
          const selection = findTextSelectionInput(mapped.interaction);
          setSelectionText(selection?.text);
          return;
        }

        contextRef.current = mapped.context;
        onInteractionChange(mapped.interaction);
        // 右键命中元素/文本锚点时，短暂显示细红框标注识别位置。
        const focusTarget = mapped.interaction.focus;
        if (focusTarget && focusTarget.scope === 'content') {
          setHighlightTarget({
            anchorType: focusTarget.anchorType,
            anchorPayload: focusTarget.anchorPayload,
          });
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
        open={aiOpen}
        anchor={aiAnchor}
        store={conversationStore}
        onClose={closeAi}
        onAsk={startAssistantTask}
        onRestore={(entry) => {
          // 恢复历史对话时标注绑定的文档位置（元素锚点 → 红框）
          const payload = entry.anchor as
            | { readonly anchorPayload?: unknown }
            | undefined;
          setHighlightTarget({
            anchorType: 'html.element',
            anchorPayload: payload?.anchorPayload,
          });
        }}
      />
      <AnchorHighlight target={highlightTarget as never} />

      {/* 选中文本后的「解释选中内容」悬浮条 */}
      {selectionText && !aiOpen && (
        <SelectionFloatBar
          text={selectionText}
          rect={{ left: 24, top: 56, bottom: 64 }}
          onExplain={(text) => {
            setSelectionText(undefined);
            openAi({
              scope: 'content',
              anchorType: 'html.quote',
              anchorVersion: 1,
              anchorPayload: { exact: text },
            });
          }}
          onDismiss={() => setSelectionText(undefined)}
        />
      )}

      {/* 常驻 AI 对话入口 */}
      <button
        type="button"
        onClick={() => openAi(undefined)}
        className="absolute right-3 top-3 z-30 rounded-full border border-indigo-300/30 bg-indigo-400/15 px-3 py-1.5 text-[10px] font-medium text-indigo-100 shadow-lg backdrop-blur-sm hover:border-indigo-300/50 hover:bg-indigo-400/25"
        aria-label="打开 AI 对话"
      >
        ✨ AI 对话
      </button>

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
