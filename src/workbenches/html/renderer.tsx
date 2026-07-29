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
import type { HtmlContextMenuEvent } from '../../shared/ipc';
import { userMessageFromError } from '../../shared/ipc-error';
import { interactionFromTextSelection } from '../../shared/workbench/selection';
import { createHtmlRendererActions } from './renderer-actions';
import {
  createHtmlLinkTarget,
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
  const contextRef = useRef<HtmlContextMenuEvent | undefined>(
    undefined,
  );
  const [frameRevision, setFrameRevision] = useState(0);
  const [loadedFrameKey, setLoadedFrameKey] = useState<string>();
  const [frameFailed, setFrameFailed] = useState(false);
  const frameKey = payload
    ? `${payload.contentUrl}:${frameRevision}`
    : 'invalid';

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
      }),
    [onOpenExternal, reload, reportError, reveal],
  );
  useWorkbenchContributions('builtin.html.viewer', rendererActions);

  useEffect(() => {
    if (!payload) {
      return;
    }

    return window.learningCompanion.onHtmlContextMenu((context) => {
      contextRef.current = context;

      const selection = context.selectionText
        ? {
            text: context.selectionText,
            target: createHtmlQuoteTarget(
              context.selectionText,
              context.frameUrl,
            ),
          }
        : undefined;
      const target =
        selection?.target ??
        (context.linkUrl
          ? createHtmlLinkTarget(context.linkUrl)
          : undefined);

      const interaction = interactionFromTextSelection(
        selection,
        target,
      );

      onInteractionChange(interaction);
      runtime.openContextMenu(
        bootstrap.sessionId,
        { x: context.x, y: context.y },
        interaction,
        { captureOutsidePointer: true },
      );
    });
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

const htmlRendererWorkbenchModule: RendererWorkbenchModule = {
  manifest: htmlWorkbenchManifest,
  View: HtmlWorkbenchView,
};

export default htmlRendererWorkbenchModule;
