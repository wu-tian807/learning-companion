/**
 * HTML assistant conversation overlay.
 *
 * A right-side panel over the document area. Pure view: the conversation
 * state machine (identity, message stream, generation task subscription,
 * persistence, restore/delete/new) lives in `conversation-controller.ts`;
 * this component renders the panel and delegates every interaction.
 */
import { createPortal } from 'react-dom';

import type { JsonValue } from '../../../shared/workbench/protocol';
import type { GenerationTaskView } from '../../../shared/generation-tasks';
import type { HtmlConversationStore } from './conversation-store';
import type { HtmlConversationEntry } from './conversation-protocol';
import { AnchorChip } from './anchor-summary';
import { ErrorBubble, MessageStream } from './conversation-messages';
import {
  useConversationController,
  type ConversationControllerOptions,
} from './conversation-controller';
import type { HtmlAiLaunchRequest } from './html-ai-launch';

export interface HtmlConversationOverlayOptions {
  readonly createId?: () => string;
  readonly createConversationId?: () => string;
  readonly now?: () => number;
}

export interface HtmlConversationOverlayProps {
  readonly open: boolean;
  /** 启动请求：由 renderer 在点击 AI 入口时构造（open-chat / explain-selection / summarize-page）。 */
  readonly launchRequest?: HtmlAiLaunchRequest;
  /** 启动请求已被 Overlay 接收；父组件据此清除一次性请求。 */
  readonly onLaunchConsumed?: (requestId: number) => void;
  readonly store: HtmlConversationStore;
  readonly onClose: () => void;
  /** Starts a generation task; resolves with the task id and its latest
   * authoritative snapshot (already reconciled against any early completion). */
  readonly onAsk: (
    conversationId: string,
    question: string,
    anchor?: JsonValue,
  ) => Promise<{
    readonly taskId: string;
    readonly snapshot?: GenerationTaskView;
  } | undefined>;
  /** Called when a history entry is restored; lets the workbench highlight the anchor. */
  readonly onRestore?: (entry: HtmlConversationEntry) => void;
  /** Reveals an anchor attached to a restored or current conversation message. */
  readonly onAnchorActivate?: (anchor: JsonValue) => void;
  /** 锚点随消息发送后调用：选中红框生命周期结束（发送即清除）。 */
  readonly onAnchorConsumed?: () => void;
  /** 锚点被主动删除（chip ✕）时调用：清除红框。 */
  readonly onAnchorRemoved?: () => void;
  /** 开启新对话（清空当前消息流与上下文）。 */
  readonly onStartNew?: () => void;
  /** Reports persistence failures that cannot be shown after the panel closes. */
  readonly onPersistenceError?: (error: unknown) => void;
  /** AI 回答进行中状态同步给 workbench（一键命令据此禁用）。 */
  readonly onBusyChange?: (busy: boolean) => void;
  /** 取消当前回答（busy 时发送按钮变为「停止」）；taskId 供父组件校验取消目标。 */
  readonly onCancelAnswer?: (taskId: string) => void;
  /** 一次回答终态（完成/失败/取消）时同步回调，父组件据此清理进行中任务引用。 */
  readonly onAnswerSettled?: (taskId: string) => void;
  /** 重跑一个失败的 GenerationTask（保留原 instruction 与 conversationId）。 */
  readonly onRetryTask?: (
    taskId: string,
  ) => Promise<{
    readonly taskId: string;
    readonly snapshot?: GenerationTaskView;
  } | undefined>;
  readonly options?: HtmlConversationOverlayOptions;
}

export function ConversationOverlay(props: HtmlConversationOverlayProps) {
  const { open } = props;
  const { state, actions } = useConversationController(
    props satisfies Parameters<typeof useConversationController>[0],
  );
  const {
    tab,
    messages,
    history,
    input,
    pendingAnchor,
    busy,
    errorText,
    scrollRef,
  } = state;
  const {
    setTab,
    setInput,
    setPendingAnchor,
    submitQuestion,
    retryTask,
    restore,
    deleteEntry,
    startNew,
    handleClose,
    handleCancelAnswer,
  } = actions;

  if (!open) {
    return null;
  }

  // 优先渲染到宿主面板贡献槽（面板打开时宿主已卸载，槽位独占整个面板）；
  // 槽位不存在（宿主面板收起/未打开）时回退渲染在 workbench 阅读区右侧。
  const portalHost =
    typeof document !== 'undefined'
      ? document.getElementById('workbench-panel-slot')
      : null;

  const overlayElement = (
    <div
      className={
        portalHost
          ? 'flex h-full w-full flex-col overflow-hidden rounded-[17px] border border-white/[0.055] bg-[#21272f] shadow-[0_20px_50px_rgba(5,8,12,0.16)]'
          : 'absolute inset-y-0 right-0 z-40 flex w-[min(320px,calc(100%-20px))] flex-col overflow-hidden rounded-[17px] border border-white/[0.055] bg-[#21272f] shadow-[-24px_0_50px_rgba(0,0,0,0.35)]'
      }
      role="dialog"
      aria-label="AI 对话"
    >
      <div className="flex items-center gap-2 border-b border-white/[0.08] px-3.5 py-3">
        <span className="size-2.5 rounded-[4px] bg-gradient-to-br from-indigo-400 to-fuchsia-400 shadow-[0_0_10px_rgba(129,140,248,0.7)]" />
        <h3 className="text-xs font-semibold text-slate-100">AI 对话</h3>
        {pendingAnchor !== undefined && (
          <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[9px] text-slate-500">
            锚点已选
          </span>
        )}
        <button
          type="button"
          onClick={startNew}
          disabled={busy}
          className="grid size-6 place-items-center rounded-md text-[11px] text-slate-500 hover:bg-white/5 hover:text-indigo-200"
          aria-label="开启新对话"
          title="开启新对话"
        >
          ✚
        </button>
        <button
          type="button"
          aria-label="关闭对话"
          onClick={handleClose}
          disabled={busy}
          title={busy ? '等待当前回答完成后再关闭' : undefined}
          className="ml-auto rounded-md px-1.5 py-0.5 text-sm text-slate-500 hover:bg-white/5 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ✕
        </button>
      </div>

      <div className="flex gap-1 px-3 pt-2">
        <button
          type="button"
          onClick={() => setTab('chat')}
          className={[
            'rounded-t-md px-3 py-1.5 text-[10px]',
            tab === 'chat'
              ? 'border-b-2 border-indigo-300 text-indigo-200'
              : 'text-slate-500 hover:text-slate-300',
          ].join(' ')}
        >
          对话
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          disabled={busy}
          className={[
            'rounded-t-md px-3 py-1.5 text-[10px]',
            tab === 'history'
              ? 'border-b-2 border-indigo-300 text-indigo-200'
              : 'text-slate-500 hover:text-slate-300',
          ].join(' ')}
        >
          历史
          {history.length > 0 && (
            <span className="ml-1.5 rounded-full bg-indigo-400/25 px-1.5 text-[8px] text-indigo-200">
              {history.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'chat' ? (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <MessageStream
              messages={messages}
              emptyLabel="选择一段内容，或直接输入你的问题。"
              onAnchorActivate={props.onAnchorActivate}
            />
          </div>
          {errorText && (
            <div className="px-3 pb-2">
              <ErrorBubble
                text={errorText}
                onRetry={retryTask}
              />
            </div>
          )}
          <div className="border-t border-white/[0.08] p-2.5">
            {/* 待发送锚点：选中后显示在输入框上方，可删除，随提问一起发出 */}
            {pendingAnchor !== undefined && (
              <div className="mb-2">
                <AnchorChip
                  anchor={pendingAnchor}
                  onRemove={() => {
                    setPendingAnchor(undefined);
                    props.onAnchorRemoved?.();
                  }}
                />
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-black/20 p-2 focus-within:border-indigo-300/40">
              <textarea
                rows={1}
                value={input}
                placeholder="输入你的问题…（Enter 发送 / Shift+Enter 换行）"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submitQuestion(input.trim(), pendingAnchor);
                  }
                }}
                className="min-h-5 max-h-24 flex-1 resize-none bg-transparent text-[11px] leading-6 text-slate-100 outline-none placeholder:text-slate-600"
              />
              <button
                type="button"
                aria-label={busy ? '停止回答' : '发送'}
                title={busy ? '停止回答' : undefined}
                disabled={!busy && input.trim().length === 0}
                onClick={
                  busy ? handleCancelAnswer : () => submitQuestion(input.trim(), pendingAnchor)
                }
                className={
                  busy
                    ? 'grid size-8 shrink-0 place-items-center rounded-lg bg-rose-500/90 text-xs text-white hover:bg-rose-400'
                    : 'grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs text-white disabled:opacity-40'
                }
              >
                {busy ? '■' : '➤'}
              </button>
            </div>
            <p className="mt-1.5 px-1 text-[9px] text-slate-600">
              首次提问会把「HTML 位置 + 选中内容」作为对话前段落一起发送
            </p>
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
          {history.length === 0 ? (
            <p className="pt-10 text-center text-[10px] leading-6 text-slate-600">
              还没有对话记录
              <br />
              在「对话」页签发起第一次提问
            </p>
          ) : (
            [...history]
              .sort(
                (left, right) =>
                  right.updatedTime - left.updatedTime ||
                  right.createdTime - left.createdTime,
              )
              .map((entry) => {
                const firstUser = entry.messages.find(
                  (message) => message.role === 'user',
                );
                return (
                  <div
                    key={entry.id}
                    className="group relative rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-indigo-300/25 hover:bg-indigo-400/10"
                  >
                  <button
                    type="button"
                    onClick={() => restore(entry)}
                    className="block w-full p-2.5 text-left"
                  >
                    <span className="block truncate text-[10.5px] font-medium text-slate-200">
                      {firstUser?.text ?? '（空对话）'}
                    </span>
                    <span className="mt-1 block truncate text-[9.5px] text-slate-500">
                      {entry.messages.length} 条消息
                    </span>
                    <span className="mt-1.5 block text-[8.5px] text-indigo-300/70">
                      {new Date(entry.createdTime).toLocaleString('zh-CN')}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="删除对话历史"
                    onClick={() => deleteEntry(entry)}
                    className="absolute right-1.5 top-1.5 rounded-md px-1.5 text-[10px] text-slate-600 opacity-0 hover:bg-white/10 hover:text-rose-300 group-hover:opacity-100"
                  >
                    🗑
                  </button>
                  </div>
                );
              })
          )}
        </div>
      )}
    </div>
  );

  return portalHost
    ? createPortal(overlayElement, portalHost)
    : overlayElement;
}

export type { ConversationControllerOptions };
