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
import { createSessionId, getGlobalAiChatStore } from './chat-store';
import {
  normalizeAiMarkdown,
  normalizeSelectedAnswerText,
} from './ai-markdown';

export function AiMarkdownContent({ content }: { readonly content: string }) {
  return (
    <div className="select-text space-y-2 break-words [&_p]:whitespace-pre-wrap [&_strong]:font-semibold [&_strong]:text-white [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/25 [&_pre]:p-3 [&_code]:font-mono [&_code]:text-[0.9em] [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normalizeAiMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AiChatContext = createContext<AiChatStore | null>(null);

export interface AiChatProviderProps {
  readonly children: ReactNode;
}

export function AiChatProvider({ children }: AiChatProviderProps) {
  const store = useMemo(() => getGlobalAiChatStore(), []);
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

export function useAiChat(
  projectId: string,
  assetId: string,
): UseAiChatResult {
  const store = useAiChatStore();
  const state = useSyncExternalStore(
    useCallback((onChange: () => void) => store.subscribe(onChange), [store]),
    useCallback(() => store.getSnapshot(), [store]),
  ) as ChatState;

  const session = state.sessions.get(createSessionId(assetId));

  const togglePanel = useCallback(() => {
    store.setPanelOpen(!state.panelOpen);
  }, [store, state.panelOpen]);

  const setDraft = useCallback(
    (text: string) => store.setDraft(text),
    [store],
  );

  const sendMessage = useCallback(
    async (content: string, anchor?: AiChatMessage['anchor']) => {
      store.ensureSession(projectId, assetId);
      const effectiveAnchor = anchor ?? store.getSession(assetId)?.pendingAnchor;
      const updated = store.addUserMessage(assetId, content, effectiveAnchor);
      const userMessage = updated.messages.at(-1)!;
      store.setDraft('');
      try {
        const result = await window.learningCompanion.askDocumentAi({
          projectId,
          assetId,
          question: content,
          ...(effectiveAnchor?.selectedText
            ? { selectedText: effectiveAnchor.selectedText }
            : {}),
          ...(effectiveAnchor?.selectedImageDataUrl
            ? { selectedImageDataUrl: effectiveAnchor.selectedImageDataUrl }
            : {}),
        });
        store.addAssistantMessage(
          assetId,
          result.answer,
          userMessage.id,
          `${result.providerId}/${result.modelId}`,
        );
      } catch (error) {
        store.setLoading(assetId, false);
        console.error('[document-ai] 提问失败', error);
      }
    },
    [store, projectId, assetId],
  );

  const setSelectedAnswerRange = useCallback(
    (range: ChatState['selectedAnswerRange']) =>
      store.setSelectedAnswerRange(range),
    [store],
  );

  const clearSession = useCallback(
    () => store.clearSession(assetId),
    [store, assetId],
  );
  const clearPendingAnchor = useCallback(
    () => {
      store.setPendingAnchor(assetId, undefined);
      store.setPanelOpen(false);
    },
    [store, assetId],
  );

  return {
    session,
    panelOpen: state.panelOpen,
    draft: state.draft,
    loading: session?.loading ?? false,
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
  readonly onAttachAnswer: (
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
  const {
    session,
    draft,
    loading,
    selectedAnswerRange,
    pendingAnchor,
    setDraft,
    sendMessage,
    setSelectedAnswerRange,
    clearSession,
    clearPendingAnchor,
  } = useAiChat(projectId, assetId);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [attachNotice, setAttachNotice] = useState<string>();
  const [copiedMessageId, setCopiedMessageId] = useState<string>();
  const messages = useMemo(
    () => session?.messages ?? [],
    [session?.messages],
  );

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
    <div className="flex h-full w-80 shrink-0 flex-col overflow-hidden border-l border-white/[0.08] bg-[#1a1f26]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.075] px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-100">AI 问答</h3>
        <div className="flex items-center gap-2">
          {attachNotice && (
            <span className="text-[11px] text-emerald-300">{attachNotice}</span>
          )}
          {selectedAnswerRange && (
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
                  <div
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
                  </div>
                </>
              ) : (
                <p className="whitespace-pre-wrap select-text">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400 [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400 [animation-delay:300ms]" />
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
        {pendingAnchor?.selectedText && (
          <div className="mb-2 flex items-start justify-between gap-2 rounded-lg bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-200">
            <span className="line-clamp-2">当前选区：{pendingAnchor.selectedText}</span>
          </div>
        )}
        {pendingAnchor?.selectedImageDataUrl && (
          <div className="mb-2 rounded-lg bg-indigo-500/10 p-2 text-[11px] text-indigo-200">
            <img
              src={pendingAnchor.selectedImageDataUrl}
              alt="已框选的公式或图像区域"
              className="mb-1.5 max-h-24 w-full rounded bg-white object-contain"
            />
            <div className="flex items-center justify-between gap-2">
              <span>已框选文档区域，将随问题一起发送给 AI</span>
              <button
                type="button"
                onClick={clearPendingAnchor}
                className="shrink-0 rounded px-1.5 py-0.5 text-rose-300 hover:bg-rose-400/10"
              >
                取消框选
              </button>
            </div>
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
  );
}
