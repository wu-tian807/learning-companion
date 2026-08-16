/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type FormEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';

import type {
  AiChatMessage,
  AiChatSession,
  AiChatState,
  AiChatStore,
} from './chat-store';
import { notifyDocumentAiQuestionCommitted } from '../question-events';
import { createSessionId, getGlobalAiChatStore } from './chat-store';
import {
  normalizeAiMarkdown,
  normalizeSelectedAnswerText,
} from './ai-markdown';
import {
  resolveWorkbenchAnchorPreview,
  revealWorkbenchAnchor,
  WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT,
} from '../../../../renderer/workbench/host/workbench-anchor-bridge';

export function AiMarkdownContent({ content }: { readonly content: string }) {
  return (
    <div className="select-text space-y-2 break-words [&_p]:whitespace-pre-wrap [&_strong]:font-semibold [&_strong]:text-white [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/25 [&_pre]:p-3 [&_code]:font-mono [&_code]:text-[0.9em] [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normalizeAiMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

function QuestionSourceCard({
  assetId,
  anchor,
}: {
  readonly assetId: string;
  readonly anchor?: AiChatMessage['anchor'];
}) {
  const pageLabel = anchor?.pageNumber
    ? `第 ${anchor.pageNumber} 页`
    : '整份资料';
  const selectedText = anchor?.selectedText?.trim();

  if (!anchor) {
    return (
      <div
        data-ai-question-source="asset"
        className="mb-1.5 rounded-xl border border-white/[0.08] bg-black/15 px-3 py-2 text-left text-[11px] text-slate-400"
      >
        <span className="font-medium text-slate-300">提问范围 · </span>
        {pageLabel}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-ai-question-source="selection"
      onClick={() => revealWorkbenchAnchor(assetId, anchor.target)}
      className="mb-1.5 w-full rounded-xl border border-indigo-300/20 bg-indigo-400/[0.08] px-3 py-2 text-left transition-colors hover:border-indigo-300/45 hover:bg-indigo-400/[0.14]"
      title="点击回到原始选区"
    >
      <span className="block text-[10px] font-medium text-indigo-200">
        选区来源 · {pageLabel} · 点击定位
      </span>
      {anchor.previewDataUrl && (
        <img
          src={anchor.previewDataUrl}
          alt={`第 ${anchor.pageNumber ?? ''} 页框选预览`}
          className="mt-1.5 max-h-28 w-full rounded-md border border-white/10 bg-white object-contain"
        />
      )}
      {selectedText ? (
        <span className="mt-1 block line-clamp-3 whitespace-pre-wrap text-[11px] leading-5 text-slate-300">
          {selectedText}
        </span>
      ) : (
        <span className="mt-1 block text-[11px] text-slate-400">
          已框选该页区域（图表、公式或图片）
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AiChatContext = createContext<AiChatStore | null>(null);

export interface AiChatProviderProps {
  readonly children: ReactNode;
  readonly store?: AiChatStore;
}

export function AiChatProvider({ children, store: providedStore }: AiChatProviderProps) {
  const store = useMemo(
    () => providedStore ?? getGlobalAiChatStore(),
    [providedStore],
  );
  return (
    <AiChatContext.Provider value={store}>
      {children}
    </AiChatContext.Provider>
  );
}

function useAiChatStore(): AiChatStore {
  const store = useContext(AiChatContext);
  return store ?? getGlobalAiChatStore();
}

// ---------------------------------------------------------------------------
// Hook: access chat for the current asset
// ---------------------------------------------------------------------------

export interface UseAiChatResult {
  readonly session: AiChatSession | undefined;
  readonly panelOpen: boolean;
  readonly draft: string;
  readonly loading: boolean;
  readonly error?: string;
  readonly selectedAnswerRange: AiChatState['selectedAnswerRange'];
  readonly pendingAnchor?: AiChatMessage['anchor'];
  togglePanel(): void;
  setDraft(text: string): void;
  sendMessage(content: string, anchor?: AiChatMessage['anchor']): Promise<void>;
  setSelectedAnswerRange(
    range: AiChatState['selectedAnswerRange'],
  ): void;
  clearSession(): void;
  clearPendingAnchor(): void;
}

type ChatState = ReturnType<AiChatStore['getSnapshot']>;
const activeRequestIds = new Map<string, string>();

function createDocumentAiRequestId(): string {
  return `document-ai-${globalThis.crypto.randomUUID()}`;
}

export function documentAiErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  if (/provider|model|selector|connection|login|配置|模型|登录/i.test(detail)) {
    return '尚未配置可用模型，或 Agent 登录已失效。请先到生成中心完成模型配置后重试。';
  }
  if (/cancel/i.test(detail)) return '本次回答已取消。';
  return detail
    ? `AI 回答失败：${detail}`
    : 'AI 回答失败，请检查网络与模型配置后重试。';
}

export async function cancelActiveDocumentAiRequest(assetId: string): Promise<void> {
  const requestId = activeRequestIds.get(assetId);
  if (!requestId) return;
  activeRequestIds.delete(assetId);
  await window.learningCompanion.cancelDocumentAi(requestId).catch(() => undefined);
}

export async function sendDocumentAiMessage(input: {
  readonly store: AiChatStore;
  readonly projectId: string;
  readonly assetId: string;
  readonly content: string;
  readonly anchor?: AiChatMessage['anchor'];
  readonly ask: typeof window.learningCompanion.askDocumentAi;
}): Promise<boolean> {
  const { store, projectId, assetId, content, anchor, ask } = input;
  if (store.getSession(assetId)?.loading) return false;
  const session = store.ensureSession(projectId, assetId);
  const effectiveAnchor = anchor ?? store.getSession(assetId)?.pendingAnchor;
  const currentConversationId = store.getSession(assetId)?.activeConversationId;
  const generateTitle = !currentConversationId ||
    !store.getSession(assetId)?.messages.some(
      (message) => message.conversationId === currentConversationId,
    );
  const updated = store.addUserMessage(assetId, content, effectiveAnchor);
  notifyDocumentAiQuestionCommitted(assetId);
  const userMessage = updated.messages.at(-1)!;
  const requestId = createDocumentAiRequestId();
  activeRequestIds.set(assetId, requestId);
  store.setDraft('');
  try {
    const result = await ask({
      projectId,
      assetId,
      requestId,
      conversationId: userMessage.conversationId ?? session.id,
      question: content,
      target: effectiveAnchor?.target ?? { scope: 'asset' },
      ...(effectiveAnchor?.selectedText
        ? { selectedText: effectiveAnchor.selectedText }
        : {}),
      ...(generateTitle ? { generateTitle: true } : {}),
    });
    store.addAssistantMessage(
      assetId,
      result.answer,
      userMessage.id,
      `${result.providerId}/${result.modelId}`,
      result.title,
    );
    return true;
  } catch (error) {
    store.setLoading(assetId, false);
    store.setError(assetId, documentAiErrorMessage(error));
    console.error('[document-ai] 提问失败', error);
    return false;
  } finally {
    if (activeRequestIds.get(assetId) === requestId) {
      activeRequestIds.delete(assetId);
    }
  }
}

export function useAiChat(
  projectId: string,
  assetId: string,
): UseAiChatResult {
  const store = useAiChatStore();
  const state = useSyncExternalStore(
    useCallback((onChange: () => void) => store.subscribe(onChange), [store]),
    useCallback(() => store.getSnapshot(), [store]),
    useCallback(() => store.getSnapshot(), [store]),
  ) as ChatState;

  const session = state.sessions.get(createSessionId(assetId));

  useEffect(() => {
    store.ensureSession(projectId, assetId);
  }, [assetId, projectId, store]);

  const togglePanel = useCallback(() => {
    store.setPanelOpen(!state.panelOpen);
  }, [store, state.panelOpen]);

  const setDraft = useCallback(
    (text: string) => store.setDraft(text),
    [store],
  );

  const sendMessage = useCallback(
    async (content: string, anchor?: AiChatMessage['anchor']) => {
      await sendDocumentAiMessage({
        store, projectId, assetId, content, anchor,
        ask: window.learningCompanion.askDocumentAi,
      });
    },
    [store, projectId, assetId],
  );

  const setSelectedAnswerRange = useCallback(
    (range: ChatState['selectedAnswerRange']) =>
      store.setSelectedAnswerRange(range),
    [store],
  );

  const clearSession = useCallback(
    () => {
      void cancelActiveDocumentAiRequest(assetId);
      store.clearSession(assetId);
    },
    [store, assetId],
  );
  const clearPendingAnchor = useCallback(
    () => {
      store.setPendingAnchor(assetId, undefined);
      store.setPanelOpen(false);
    },
    [store, assetId],
  );

  useEffect(() => () => {
    void cancelActiveDocumentAiRequest(assetId);
  }, [assetId]);

  return {
    session,
    panelOpen: state.panelOpen,
    draft: state.draft,
    loading: session?.loading ?? false,
    error: session?.error,
    selectedAnswerRange: state.selectedAnswerRange,
    pendingAnchor: session?.pendingAnchor,
    togglePanel,
    setDraft,
    sendMessage,
    setSelectedAnswerRange,
    clearSession,
    clearPendingAnchor,
  };
}

// ---------------------------------------------------------------------------
// Chat panel component
// ---------------------------------------------------------------------------

export interface AiChatPanelProps {
  readonly projectId: string;
  readonly assetId: string;
  readonly onClose: () => void;
  /**
   * Optional so the question module can be mounted at Project scope. A
   * workbench that supports annotations may provide this capability, while
   * other media workbenches still get the same conversation UI.
   */
  readonly onAttachAnswer?: (
    messageId: string,
    text: string,
    anchor?: AiChatMessage['anchor'],
  ) => Promise<void> | void;
}

export function AiChatPanel({
  projectId,
  assetId,
  onClose,
  onAttachAnswer,
}: AiChatPanelProps) {
  const store = useAiChatStore();
  const {
    session,
    draft,
    loading,
    error,
    selectedAnswerRange,
    setDraft,
    sendMessage,
    setSelectedAnswerRange,
    clearSession,
  } = useAiChat(projectId, assetId);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [attachNotice, setAttachNotice] = useState<string>();
  const [copiedMessageId, setCopiedMessageId] = useState<string>();
  const conversations = store.getConversations(assetId);
  const activeConversationId = session?.activeConversationId ??
    (session?.pendingAnchor ? undefined : conversations.at(0)?.id);
  const messages = (session?.messages ?? []).filter(
    (message) => message.conversationId === activeConversationId,
  );

  useEffect(() => {
    const restoreMissingSourcePreviews = () => {
      for (const message of messages) {
        if (
          message.role !== 'user' ||
          !message.anchor ||
          message.anchor.previewDataUrl
        ) {
          continue;
        }
        const previewDataUrl = resolveWorkbenchAnchorPreview(
          assetId,
          message.anchor.target,
        );
        if (previewDataUrl) {
          store.setMessageAnchorPreview(
            assetId,
            message.id,
            previewDataUrl,
          );
        }
      }
    };

    restoreMissingSourcePreviews();
    window.addEventListener(
      WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT,
      restoreMissingSourcePreviews,
    );
    return () => window.removeEventListener(
      WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT,
      restoreMissingSourcePreviews,
    );
  }, [assetId, messages, store]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleQuickQuestion = (event: Event) => {
      const detail = (event as CustomEvent<{
        assetId?: string;
        question?: string;
        focusOnly?: boolean;
      }>).detail;
      if (detail?.assetId !== assetId) {
        return;
      }
      if (detail.focusOnly) {
        inputRef.current?.focus();
        return;
      }
      if (
        typeof detail.question !== 'string' ||
        detail.question.trim().length === 0 ||
        loading
      ) return;
      void sendMessage(detail.question.trim());
    };
    window.addEventListener('learning-companion:ai-quick-question', handleQuickQuestion);
    return () => {
      window.removeEventListener('learning-companion:ai-quick-question', handleQuickQuestion);
    };
  }, [assetId, loading, sendMessage]);

  const handleSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const trimmed = draft.trim();
      if (!trimmed || loading) {
        return;
      }
      void sendMessage(trimmed);
    },
    [draft, loading, sendMessage],
  );

  const handleMessageMouseUp = useCallback(
    (messageId: string) => {
      const selection = window.getSelection();
      const text = selection
        ? normalizeSelectedAnswerText(selection.toString())
        : '';
      if (text) {
        setSelectedAnswerRange({ messageId, text });
      } else {
        setSelectedAnswerRange(null);
      }
    },
    [setSelectedAnswerRange],
  );

  const attachAnswerMessage = useCallback(
    async (answer: AiChatMessage, text: string) => {
      const userQuestion = messages.find(
        (message) => message.id === answer.replyToMessageId,
      );
      try {
        if (!onAttachAnswer) return;
        await onAttachAnswer(answer.id, text, userQuestion?.anchor);
        setSelectedAnswerRange(null);
        setAttachNotice('已附着到当前文档');
        window.setTimeout(() => setAttachNotice(undefined), 2_500);
      } catch {
        setAttachNotice('附着失败，请重试');
      }
    },
    [messages, onAttachAnswer, setSelectedAnswerRange],
  );

  const handleAttach = useCallback(async () => {
    if (!selectedAnswerRange) return;
    const answer = messages.find(
      (message) => message.id === selectedAnswerRange.messageId,
    );
    if (answer) {
      await attachAnswerMessage(answer, selectedAnswerRange.text);
    }
  }, [attachAnswerMessage, messages, selectedAnswerRange]);

  return (
    <div className="flex h-full min-h-0 w-[30rem] shrink-0 flex-col overflow-hidden border-l border-white/[0.08] bg-[#1a1f26]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.075] px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-100">AI 问答</h3>
        <div className="flex items-center gap-2">
          {attachNotice && (
            <span className="text-[11px] text-emerald-300">{attachNotice}</span>
          )}
          {selectedAnswerRange && onAttachAnswer && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleAttach()}
                className="rounded-full bg-indigo-500/20 px-3 py-1 text-[11px] font-medium text-indigo-300 hover:bg-indigo-500/30 transition-colors"
                title="将选中的回答片段附着到文档"
              >
                附着选中内容
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={clearSession}
            className="rounded-lg px-2 py-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
            title="清空对话"
          >
            清空
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
            title="关闭面板"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-36 shrink-0 overflow-y-auto border-r border-white/[0.07] bg-black/10 p-2">
          <p className="px-2 pb-2 pt-1 text-[10px] font-medium text-slate-500">最近提问</p>
          <div className="space-y-1">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                aria-pressed={conversation.id === activeConversationId}
                onClick={() => {
                  store.selectConversation(assetId, conversation.id);
                  if (conversation.anchor) {
                    revealWorkbenchAnchor(assetId, conversation.anchor.target);
                  }
                }}
                className={`w-full rounded-lg px-2 py-2 text-left text-[11px] leading-4 transition-colors ${
                  conversation.id === activeConversationId
                    ? 'bg-indigo-400/15 text-indigo-100'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                }`}
                title={conversation.title}
              >
                <span className="line-clamp-2">{conversation.title}</span>
                {conversation.anchor?.pageNumber && (
                  <span className="mt-1 block text-[9px] text-slate-600">
                    第 {conversation.anchor.pageNumber} 页
                  </span>
                )}
              </button>
            ))}
          </div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="py-8 text-center text-xs text-slate-600">
            <p>选中文档内容，右键选择「就选中内容问 AI」</p>
            <p className="mt-1">可以输入任何问题，并附着回答中的任意片段</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            onMouseUp={() =>
              msg.role === 'assistant' && handleMessageMouseUp(msg.id)
            }
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className="max-w-[85%]">
              {msg.role === 'user' && (
                <QuestionSourceCard
                  assetId={assetId}
                  anchor={msg.anchor}
                />
              )}
              <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-indigo-500/25 text-slate-100 rounded-br-md'
                  : 'bg-white/[0.06] text-slate-200 rounded-bl-md'
              }`}
            >
              {msg.anchor?.selectedText && (
                <div className="mb-1.5 rounded-lg bg-black/20 px-2 py-1 text-[11px] text-slate-400 italic">
                  「{msg.anchor.selectedText.slice(0, 80)}
                  {msg.anchor.selectedText.length > 80 ? '…' : ''}」
                </div>
              )}
              {msg.role === 'assistant' ? (
                <>
                  <AiMarkdownContent content={msg.content} />
                  {onAttachAnswer && <div
                    className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-white/[0.07] pt-2"
                    onMouseUp={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => void attachAnswerMessage(msg, msg.content)}
                      className="rounded-md px-1.5 py-1 text-[10px] text-indigo-300 hover:bg-indigo-400/10"
                      title="将整条回答附着到原文选区"
                    >
                      附着整段
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(msg.content);
                        setCopiedMessageId(msg.id);
                        window.setTimeout(() => setCopiedMessageId(undefined), 1_500);
                      }}
                      className="rounded-md px-1.5 py-1 text-[10px] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
                    >
                      {copiedMessageId === msg.id ? '已复制' : '复制'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft('请基于刚才的回答继续深入解释，并补充容易混淆的地方。');
                        inputRef.current?.focus();
                      }}
                      className="rounded-md px-1.5 py-1 text-[10px] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
                    >
                      继续追问
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        const question = messages.find(
                          (message) => message.id === msg.replyToMessageId,
                        );
                        if (question) {
                          void sendMessage(question.content, question.anchor);
                        }
                      }}
                      className="rounded-md px-1.5 py-1 text-[10px] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-40"
                    >
                      重新回答
                    </button>
                  </div>}
                </>
              ) : (
                <p className="whitespace-pre-wrap select-text">{msg.content}</p>
              )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>正在回答，已优先使用当前选区</span>
                <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400 [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400 [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-white/[0.075] p-3"
      >
        {error && (
          <div role="alert" className="mb-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs leading-5 text-rose-200">
            {error}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={loading}
            placeholder={
              loading ? 'AI 正在思考…' : '输入你的问题…'
            }
            className="min-w-0 flex-1 rounded-xl border border-white/[0.1] bg-black/15 px-3.5 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-400/40 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!draft.trim() || loading}
            className="shrink-0 rounded-xl bg-indigo-500/30 p-2 text-indigo-300 hover:bg-indigo-500/40 disabled:opacity-30 transition-colors"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </form>
        </div>
      </div>
    </div>
  );
}
