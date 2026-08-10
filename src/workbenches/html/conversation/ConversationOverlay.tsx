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
import { createPortal } from 'react-dom';

import type { JsonValue } from '../../../shared/workbench/protocol';
import type { GenerationTaskEvent } from '../../../shared/generation-tasks';
import type { HtmlConversationStore } from './conversation-store';
import type { HtmlConversationEntry } from './conversation-protocol';
import { AnchorChip } from './anchor-summary';
import { ErrorBubble, MessageStream } from './conversation-messages';

export interface HtmlConversationOverlayOptions {
  readonly createId?: () => string;
  readonly createConversationId?: () => string;
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
  /** Called when a history entry is restored; lets the workbench highlight the anchor. */
  readonly onRestore?: (entry: HtmlConversationEntry) => void;
  /** 锚点随消息发送后调用：选中红框生命周期结束（发送即清除）。 */
  readonly onAnchorConsumed?: () => void;
  /** 锚点被主动删除（chip ✕）时调用：清除红框。 */
  readonly onAnchorRemoved?: () => void;
  /** 开启新对话（清空当前消息流与上下文）。 */
  readonly onStartNew?: () => void;
  /** Reports persistence failures that cannot be shown after the panel closes. */
  readonly onPersistenceError?: (error: unknown) => void;
  readonly options?: HtmlConversationOverlayOptions;
}

interface DisplayMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly streaming?: boolean;
  /** 该消息绑定的锚点（提问时随消息一起发出）。 */
  readonly anchor?: JsonValue;
}

interface ActiveStream {
  readonly taskId: string;
}

interface ConversationIdentity {
  readonly id: string;
  readonly createdTime: number;
  persistedFingerprint?: string;
  readonly pendingSaves: Map<string, Promise<void>>;
  deleted: boolean;
}

function createDisplayId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createConversationId(): string {
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function entryToMessages(entry: HtmlConversationEntry): DisplayMessage[] {
  return entry.messages.map((message, index) => ({
    id: `restored:${entry.id}:${index}`,
    role: message.role,
    text: message.text,
    ...(message.anchor === undefined ? {} : { anchor: message.anchor }),
  }));
}

function archivedMessages(messages: readonly DisplayMessage[]) {
  return messages
    .filter((message) => message.text.trim().length > 0)
    .map((message) => ({
      role: message.role,
      text: message.text,
      ...(message.anchor === undefined ? {} : { anchor: message.anchor }),
    }));
}

function messagesFingerprint(
  messages: ReturnType<typeof archivedMessages>,
): string {
  return JSON.stringify(messages);
}

export function ConversationOverlay({
  open,
  anchor,
  store,
  onClose,
  onAsk,
  onRestore,
  onAnchorConsumed,
  onAnchorRemoved,
  onStartNew,
  onPersistenceError,
  options = {},
}: HtmlConversationOverlayProps) {
  const createId = options.createId ?? createDisplayId;
  const createArchiveId =
    options.createConversationId ?? createConversationId;
  const now = options.now ?? Date.now;
  const [tab, setTab] = useState<'chat' | 'history'>('chat');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [history, setHistory] = useState<readonly HtmlConversationEntry[]>([]);
  const [input, setInput] = useState('');
  const [pendingAnchor, setPendingAnchor] = useState<JsonValue>();
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string>();
  const streamRef = useRef<ActiveStream | undefined>(undefined);
  const streamMessageIdRef = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const messagesRef = useRef<DisplayMessage[]>([]);
  const mountedRef = useRef(true);
  const identityRef = useRef<ConversationIdentity | undefined>(undefined);
  if (!identityRef.current) {
    identityRef.current = {
      id: createArchiveId(),
      createdTime: now(),
      pendingSaves: new Map(),
      deleted: false,
    };
  }
  busyRef.current = busy;

  const replaceMessages = (next: DisplayMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
    return next;
  };

  const updateMessages = (
    update: (current: DisplayMessage[]) => DisplayMessage[],
  ) => replaceMessages(update(messagesRef.current));

  const resetConversation = () => {
    identityRef.current = {
      id: createArchiveId(),
      createdTime: now(),
      pendingSaves: new Map(),
      deleted: false,
    };
    streamRef.current = undefined;
    streamMessageIdRef.current = undefined;
    busyRef.current = false;
    setBusy(false);
    replaceMessages([]);
  };

  const persistConversation = (updatedTime = now()): Promise<void> => {
    const identity = identityRef.current!;
    if (identity.deleted) {
      return Promise.resolve();
    }

    const archive = archivedMessages(messagesRef.current);
    if (archive.length === 0) {
      return Promise.resolve();
    }
    const fingerprint = messagesFingerprint(archive);
    if (identity.persistedFingerprint === fingerprint) {
      return Promise.resolve();
    }
    const pending = identity.pendingSaves.get(fingerprint);
    if (pending) {
      return pending;
    }

    const persistence = store
      .save({
        id: identity.id,
        messages: archive,
        createdTime: identity.createdTime,
        updatedTime: Math.max(identity.createdTime, updatedTime),
      })
      .then(
        (entries) => {
          identity.pendingSaves.delete(fingerprint);
          identity.persistedFingerprint = fingerprint;
          if (mountedRef.current) {
            setHistory(entries);
          }
        },
        (error: unknown) => {
          identity.pendingSaves.delete(fingerprint);
          if (mountedRef.current) {
            setErrorText('无法保存对话记录，请稍后重试。');
          }
          onPersistenceError?.(error);
        },
      );
    identity.pendingSaves.set(fingerprint, persistence);
    return persistence;
  };

  const persistConversationRef = useRef(persistConversation);
  persistConversationRef.current = persistConversation;

  // 外部传入新锚点（右键/选中触发）→ 设为待发送锚点，显示在输入框上方。
  useEffect(() => {
    if (anchor !== undefined) {
      setPendingAnchor(anchor);
    }
  }, [anchor]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void persistConversationRef.current();
    };
  }, []);

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

  // Keep the subscription alive while the panel is hidden so an answer that
  // completes immediately after close can still replace the partial archive.
  const generationEventHandlerRef = useRef<
    (event: GenerationTaskEvent) => void
  >(() => undefined);
  generationEventHandlerRef.current = (event: GenerationTaskEvent) => {
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
        updateMessages((current) =>
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
  };

  // 流式回答：订阅 generation task 事件，增量渲染当前消息。
  useEffect(() => {
    return window.learningCompanion.onGenerationTaskChanged(
      (event: GenerationTaskEvent) => {
        generationEventHandlerRef.current(event);
      },
    );
  }, []);

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
    busyRef.current = false;
    setBusy(false);
  }

  function finalizeStream(updatedTime: number) {
    const pending = streamRef.current;
    const messageId = streamMessageIdRef.current;
    finishStreamState();

    if (!pending || !messageId) {
      return;
    }

    // 消息流留在内存；关闭对话时（handleClose）统一整体存档为一条历史。
    updateMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? { ...message, streaming: false }
          : message,
      ),
    );
    void persistConversation(updatedTime);
  }

  function failStream() {
    const messageId = streamMessageIdRef.current;
    finishStreamState();
    if (messageId) {
      updateMessages((current) =>
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
    // 锚点随本条消息一起发出；发出后清除待发送锚点（等待下一次选中）
    const messageAnchor = pendingAnchor;
    setPendingAnchor(undefined);
    if (messageAnchor !== undefined) {
      onAnchorConsumed?.();
    }
    updateMessages((current) => [
      ...current,
      {
        id: userMessageId,
        role: 'user',
        text: question,
        ...(messageAnchor === undefined ? {} : { anchor: messageAnchor }),
      },
      { id: streamMessageId, role: 'assistant', text: '', streaming: true },
    ]);
    busyRef.current = true;
    setBusy(true);

    void onAsk(question, messageAnchor).then(
      (taskId) => {
        if (taskId) {
          streamRef.current = { taskId };
          streamMessageIdRef.current = streamMessageId;
          return;
        }

        // 任务未创建成功：结束流式占位并提示。
        updateMessages((current) =>
          current.map((message) =>
            message.id === streamMessageId
              ? { ...message, streaming: false }
              : message,
          ),
        );
        busyRef.current = false;
        setBusy(false);
        setInput(question);
        setErrorText('无法发起 AI 对话，请重试。');
      },
      () => {
        updateMessages((current) =>
          current.map((message) =>
            message.id === streamMessageId
              ? { ...message, streaming: false }
              : message,
          ),
        );
        busyRef.current = false;
        setBusy(false);
        setInput(question);
        setErrorText('无法发起 AI 对话，请重试。');
      },
    );
  };

  const restore = (entry: HtmlConversationEntry) => {
    if (busyRef.current) {
      return;
    }
    void persistConversation();
    const archive = archivedMessages(entryToMessages(entry));
    identityRef.current = {
      id: entry.id,
      createdTime: entry.createdTime,
      persistedFingerprint: messagesFingerprint(archive),
      pendingSaves: new Map(),
      deleted: false,
    };
    setTab('chat');
    replaceMessages(entryToMessages(entry));
    setErrorText(undefined);
    onRestore?.(entry);
  };

  const handleClose = () => {
    if (busyRef.current) {
      return;
    }
    void persistConversation();
    onClose();
  };

  const startNew = () => {
    if (busyRef.current) {
      return;
    }
    void persistConversation();
    resetConversation();
    setPendingAnchor(undefined);
    setErrorText(undefined);
    setTab('chat');
    onStartNew?.();
  };

  if (!open) {
    return null;
  }

  // 优先渲染到生成中心替换槽（对话栏打开时生成中心已卸载，槽位独占整个面板）；
  // 槽位不存在（生成中心收起/未打开）时回退渲染在 workbench 阅读区右侧。
  const portalHost =
    typeof document !== 'undefined'
      ? document.getElementById('html-ai-overlay-slot')
      : null;

  const overlayElement = (
    <div
      className={
        portalHost
          ? 'flex h-full w-full flex-col overflow-hidden bg-[#21272f]'
          : 'absolute inset-y-0 right-0 z-40 flex w-[320px] flex-col border-l border-white/10 bg-[#21272f] shadow-[-24px_0_50px_rgba(0,0,0,0.35)]'
      }
      role="dialog"
      aria-label="AI 对话"
    >
      <div className="flex items-center gap-2 border-b border-white/[0.08] px-3.5 py-3">
        <span className="size-2.5 rounded-[4px] bg-gradient-to-br from-indigo-400 to-fuchsia-400 shadow-[0_0_10px_rgba(129,140,248,0.7)]" />
        <h3 className="text-xs font-semibold text-slate-100">AI 对话</h3>
        {(pendingAnchor !== undefined || anchor !== undefined) && (
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
            />
          </div>
          {errorText && (
            <div className="px-3 pb-2">
              <ErrorBubble text={errorText} onRetry={() => ask()} />
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
                    onAnchorRemoved?.();
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
                    onClick={() => {
                      const currentIdentity = identityRef.current!;
                      const deletingCurrent = currentIdentity.id === entry.id;
                      if (deletingCurrent) {
                        currentIdentity.deleted = true;
                      }
                      void store
                        .remove(entry.id)
                        .then((entries) => {
                          setHistory(entries);
                          if (
                            deletingCurrent &&
                            identityRef.current === currentIdentity
                          ) {
                            resetConversation();
                          }
                        })
                        .catch((error: unknown) => {
                          currentIdentity.deleted = false;
                          setErrorText('无法删除对话记录，请稍后重试。');
                          onPersistenceError?.(error);
                        });
                    }}
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
