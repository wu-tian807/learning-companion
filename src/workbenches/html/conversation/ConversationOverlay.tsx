/**
 * HTML assistant conversation overlay.
 *
 * A right-side panel over the document area. Owns the conversation state
 * machine (idle / ready / awaiting / streaming / restoring), the message
 * stream, and the history tab. Asking a question delegates to `onAsk`
 * (renderer starts the generation task) and streams `assistant-delta`
 * events back into the current message.
 */
import { useEffect, useRef, useState } from 'react';

import type { JsonValue } from '../../../shared/workbench/protocol';
import type { GenerationTaskEvent } from '../../../shared/generation-tasks';
import type { HtmlConversationStore } from './conversation-store';
import type { HtmlConversationEntry } from './conversation-protocol';
import { AnchorChip } from './anchor-summary';
import { ErrorBubble, MessageStream } from './conversation-messages';

export interface HtmlConversationOverlayOptions {
  readonly createId?: () => string;
  readonly now?: () => number;
}

export interface HtmlConversationOverlayProps {
  readonly open: boolean;
  readonly anchor?: JsonValue;
  readonly store: HtmlConversationStore;
  readonly onClose: () => void;
  /** Starts a generation task; resolves with the task id (or undefined on failure). */
  readonly onAsk: (
    question: string,
    anchor?: JsonValue,
  ) => Promise<string | undefined>;
  readonly options?: HtmlConversationOverlayOptions;
}

interface DisplayMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly streaming?: boolean;
}

interface ActiveStream {
  readonly taskId: string;
  readonly question: string;
  readonly anchor?: JsonValue;
}

function createDisplayId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function entryToMessages(entry: HtmlConversationEntry): DisplayMessage[] {
  return [
    { id: `${entry.id}:q`, role: 'user', text: entry.question },
    { id: `${entry.id}:a`, role: 'assistant', text: entry.answer },
  ];
}

function anchorLabel(anchor: JsonValue): string {
  if (typeof anchor !== 'object' || anchor === null) {
    return '内容';
  }
  const record = anchor as Record<string, unknown>;
  const payload =
    typeof record.anchorPayload === 'object' && record.anchorPayload !== null
      ? (record.anchorPayload as Record<string, unknown>)
      : {};
  if (record.anchorType === 'html.quote') {
    return typeof payload.exact === 'string' ? payload.exact : '选中文本';
  }
  if (record.anchorType === 'html.element') {
    return typeof payload.id === 'string' && payload.id ? `#${payload.id}` : '元素';
  }
  if (record.anchorType === 'html.link') {
    return typeof payload.url === 'string' ? payload.url : '链接';
  }
  return '内容';
}

export function ConversationOverlay({
  open,
  anchor,
  store,
  onClose,
  onAsk,
  options = {},
}: HtmlConversationOverlayProps) {
  const createId = options.createId ?? createDisplayId;
  const now = options.now ?? Date.now;
  const [tab, setTab] = useState<'chat' | 'history'>('chat');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [history, setHistory] = useState<readonly HtmlConversationEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string>();
  const streamRef = useRef<ActiveStream | undefined>(undefined);
  const streamMessageIdRef = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  // 打开时加载历史列表。
  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    void store
      .list()
      .then((entries) => {
        if (active) {
          setHistory(entries);
        }
      })
      .catch(() => {
        if (active) {
          setErrorText('无法读取对话记录。');
        }
      });
    return () => {
      active = false;
    };
  }, [open, store]);

  // 流式回答：订阅 generation task 事件，增量渲染当前消息。
  useEffect(() => {
    if (!open) {
      return;
    }
    const unsubscribe = window.learningCompanion.onGenerationTaskChanged(
      (event: GenerationTaskEvent) => {
        const active = streamRef.current;

        if (event.type === 'execution-event') {
          if (active?.taskId !== event.taskId) {
            return;
          }
          if (event.event.type === 'assistant-delta') {
            const messageId = streamMessageIdRef.current;
            if (!messageId) {
              return;
            }
            const delta = event.event.delta;
            setMessages((current) =>
              current.map((message) =>
                message.id === messageId
                  ? { ...message, text: message.text + delta }
                  : message,
              ),
            );
          }
          return;
        }

        if (event.type === 'task-changed' || event.type === 'task-completed') {
          const snapshot = event.snapshot;
          if (active?.taskId !== snapshot.id) {
            return;
          }
          if (snapshot.status === 'completed') {
            finalizeStream(snapshot.updatedTime);
          } else if (snapshot.status === 'failed' || snapshot.failure) {
            failStream();
          }
        }
      },
    );
    return unsubscribe;
  }, [open]);

  // 消息变化时滚动到底部。
  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) {
      scroll.scrollTop = scroll.scrollHeight;
    }
  }, [messages]);

  function finishStreamState() {
    streamRef.current = undefined;
    streamMessageIdRef.current = undefined;
    setBusy(false);
  }

  function finalizeStream(updatedTime: number) {
    const pending = streamRef.current;
    const messageId = streamMessageIdRef.current;
    finishStreamState();

    if (!pending || !messageId) {
      return;
    }

    setMessages((current) => {
      const answerMessage = current.find(
        (message) => message.id === messageId,
      );
      const answer = answerMessage?.text ?? '';

      if (answer.trim().length > 0) {
        void store
          .append({
            id: pending.taskId,
            question: pending.question,
            answer,
            ...(pending.anchor ? { anchor: pending.anchor } : {}),
            createdTime: updatedTime || now(),
          })
          .then(setHistory)
          .catch(() => undefined);
      }
      return current.map((message) =>
        message.id === messageId
          ? { ...message, streaming: false }
          : message,
      );
    });
  }

  function failStream() {
    const messageId = streamMessageIdRef.current;
    finishStreamState();
    if (messageId) {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? { ...message, streaming: false }
            : message,
        ),
      );
    }
    setErrorText('AI 回答失败，请重试。');
  }

  const ask = () => {
    const question = input.trim();
    if (!question || busyRef.current) {
      return;
    }
    setErrorText(undefined);
    setInput('');
    const userMessageId = createId();
    const streamMessageId = createId();
    setMessages((current) => [
      ...current,
      { id: userMessageId, role: 'user', text: question },
      { id: streamMessageId, role: 'assistant', text: '', streaming: true },
    ]);
    setBusy(true);
    void onAsk(question, anchor).then((taskId) => {
      if (taskId) {
        streamRef.current = {
          taskId,
          question,
          ...(anchor ? { anchor } : {}),
        };
        streamMessageIdRef.current = streamMessageId;
      } else {
        // 任务未创建成功：结束流式占位并提示。
        setMessages((current) =>
          current.map((message) =>
            message.id === streamMessageId
              ? { ...message, streaming: false }
              : message,
          ),
        );
        setBusy(false);
        setErrorText('无法发起 AI 对话，请重试。');
      }
    });
  };

  const restore = (entry: HtmlConversationEntry) => {
    setTab('chat');
    setMessages(entryToMessages(entry));
    setErrorText(undefined);
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="absolute inset-y-0 right-0 z-40 flex w-[320px] flex-col border-l border-white/10 bg-[#21272f] shadow-[-24px_0_50px_rgba(0,0,0,0.35)]"
      role="dialog"
      aria-label="AI 对话"
    >
      <div className="flex items-center gap-2 border-b border-white/[0.08] px-3.5 py-3">
        <span className="size-2.5 rounded-[4px] bg-gradient-to-br from-indigo-400 to-fuchsia-400 shadow-[0_0_10px_rgba(129,140,248,0.7)]" />
        <h3 className="text-xs font-semibold text-slate-100">AI 对话</h3>
        {anchor && (
          <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[9px] text-slate-500">
            锚点已选
          </span>
        )}
        <button
          type="button"
          aria-label="关闭对话"
          onClick={onClose}
          className="ml-auto rounded-md px-1.5 py-0.5 text-sm text-slate-500 hover:bg-white/5 hover:text-slate-200"
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
          {anchor && <AnchorChip anchor={anchor} />}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <MessageStream
              messages={messages}
              emptyLabel="选择一段内容，或直接输入你的问题。"
            />
          </div>
          {errorText && (
            <div className="px-3 pb-2">
              <ErrorBubble text={errorText} onRetry={() => ask()} />
            </div>
          )}
          <div className="border-t border-white/[0.08] p-2.5">
            <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-black/20 p-2 focus-within:border-indigo-300/40">
              <textarea
                rows={1}
                value={input}
                placeholder="输入你的问题…（Enter 发送 / Shift+Enter 换行）"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    ask();
                  }
                }}
                className="min-h-5 max-h-24 flex-1 resize-none bg-transparent text-[11px] leading-6 text-slate-100 outline-none placeholder:text-slate-600"
              />
              <button
                type="button"
                aria-label="发送"
                disabled={busy || input.trim().length === 0}
                onClick={ask}
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs text-white disabled:opacity-40"
              >
                ➤
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
            [...history].reverse().map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => restore(entry)}
                className="block w-full rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 text-left hover:border-indigo-300/25 hover:bg-indigo-400/10"
              >
                <span className="block truncate text-[10.5px] font-medium text-slate-200">
                  {entry.question}
                </span>
                <span className="mt-1 block truncate text-[9.5px] text-slate-500">
                  {entry.answer}
                </span>
                {entry.anchor && (
                  <span className="mt-1.5 block text-[8.5px] text-indigo-300/70">
                    锚点：{anchorLabel(entry.anchor)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
