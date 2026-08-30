import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import type {
  ConversationContextPresentation,
  ConversationMessageContextSource,
  ConversationMessageRecord,
  ConversationRecord,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import type {
  ConversationControllerActions,
  ConversationControllerState,
} from './conversation-controller';
import { ConversationMarkdown } from './conversation-markdown';
import { normalizeConversationSelection } from './conversation-text';
import {
  PROJECT_CONVERSATION_EMPTY_LABEL,
  PROJECT_CONVERSATION_INPUT_PLACEHOLDER,
  PROJECT_CONVERSATION_TITLE,
} from './project-conversation-presentation';

function needsProviderSettings(code: string | undefined, message: string): boolean {
  return (
    code === 'AGENT_PROVIDER_SELECTION_REQUIRED' ||
    code === 'AGENT_PROVIDER_AUTH_REQUIRED' ||
    /provider|selector|connection|login|模型|登录|配置/iu.test(message)
  );
}

function ContextCard({
  presentation,
  onReveal,
  removable,
  onRemove,
  onRevealError,
}: {
  readonly presentation?: ConversationContextPresentation;
  readonly onReveal?: () => Promise<void> | void;
  readonly removable?: boolean;
  readonly onRemove?: () => void;
  readonly onRevealError?: (error: unknown) => void;
}) {
  const contentPresentation = presentation ?? {
    label: '引用内容',
  };
  const content = (
    <>
      <span className="block text-[11px] font-semibold text-indigo-200">
        {contentPresentation.label}
      </span>
      {contentPresentation.previewDataUrl && (
        <img
          src={contentPresentation.previewDataUrl}
          alt={contentPresentation.label}
          className="mt-2 max-h-32 w-full rounded-lg border border-white/10 bg-white object-contain"
        />
      )}
      {contentPresentation.detail && (
        <span className="mt-1 block line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-slate-400">
          {contentPresentation.detail}
        </span>
      )}
    </>
  );

  return (
    <div className="relative rounded-xl border border-indigo-300/20 bg-indigo-400/[0.08] p-2.5">
      {onReveal ? (
        <button
          type="button"
          className="block w-full pr-7 text-left hover:text-indigo-100"
          title="在原文中查看"
          onClick={() => {
            void Promise.resolve()
              .then(onReveal)
              .catch((error: unknown) => onRevealError?.(error));
          }}
        >
          {content}
          <span className="mt-1.5 block text-[10px] text-indigo-300/70">
            查看原文位置
          </span>
        </button>
      ) : content}
      {removable && (
        <button
          type="button"
          aria-label="移除引用内容"
          onClick={onRemove}
          className="absolute right-2 top-2 grid size-6 place-items-center rounded-md text-xs text-slate-500 hover:bg-white/10 hover:text-slate-200"
        >
          ×
        </button>
      )}
    </div>
  );
}

function QuestionForAnswer(
  conversation: ConversationRecord,
  answer: ConversationMessageRecord,
): ConversationMessageRecord | undefined {
  return conversation.messages.find((message) => message.id === answer.replyToMessageId);
}

function MessageBubble({
  message,
  contextPresentation,
  answerContribution,
  busy,
  answerActionPending,
  onContinue,
  onReanswer,
  onSelectedAnswer,
  onAnswerAction,
  onRevealContext,
}: {
  readonly message: ConversationMessageRecord;
  readonly contextPresentation?: ConversationContextPresentation;
  readonly answerContribution?: WorkbenchConversationContribution;
  readonly busy: boolean;
  readonly answerActionPending: boolean;
  readonly onContinue: () => void;
  readonly onReanswer: (answerId: string) => void;
  readonly onSelectedAnswer: (messageId: string, text: string) => void;
  readonly onAnswerAction: (answer: ConversationMessageRecord, text: string) => void;
  readonly onRevealContext?: () => Promise<void> | void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[88%]">
        {message.role === 'user' &&
          (message.context !== undefined ||
            message.contextSource !== undefined) && (
          <div className="mb-1.5">
            <ContextCard
              presentation={contextPresentation}
              onReveal={onRevealContext}
            />
          </div>
        )}
        <div
          onMouseUp={() => {
            if (
              message.role !== 'assistant' ||
              !answerContribution?.answerAction
            ) {
              return;
            }
            const selected = normalizeConversationSelection(window.getSelection()?.toString() ?? '');
            if (selected) onSelectedAnswer(message.id, selected);
          }}
          className={`rounded-2xl border px-3.5 py-2.5 text-[13px] leading-6 ${
            message.role === 'user'
              ? 'rounded-br-md border-indigo-300/20 bg-indigo-500/20 text-slate-100'
              : 'rounded-bl-md border-white/[0.06] bg-white/[0.045] text-slate-200'
          }`}
        >
          {message.role === 'assistant' ? (
            message.text ? (
              <ConversationMarkdown text={message.text} />
            ) : (
              <span className="text-slate-500">等待回答…</span>
            )
          ) : (
            <p className="whitespace-pre-wrap select-text">{message.text}</p>
          )}
          {message.stopped && (
            <span className="mt-2 inline-block rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] text-slate-400">
              已停止
            </span>
          )}
          {message.role === 'assistant' && message.text && (
            <div
              className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-white/[0.07] pt-2"
              onMouseUp={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(message.text);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1_500);
                }}
                className="rounded-md px-1.5 py-1 text-[11px] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
              >
                {copied ? '已复制' : '复制'}
              </button>
              <button
                type="button"
                disabled={busy}
                title={busy ? '当前回答生成中，完成或停止后可重新回答' : '不满意时让 AI 重新回答'}
                onClick={() => onReanswer(message.id)}
                className="rounded-md px-1.5 py-1 text-[11px] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-40"
              >
                重新回答
              </button>
              {answerContribution?.answerAction && (
                <button
                  type="button"
                  disabled={busy || answerActionPending}
                  onClick={() => onAnswerAction(message, message.text)}
                  className="rounded-md px-1.5 py-1 text-[11px] font-medium text-indigo-300 hover:bg-indigo-400/10 disabled:opacity-40"
                >
                  {answerContribution.answerAction.label}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={onContinue}
                className="rounded-md px-1.5 py-1 text-[11px] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-40"
              >
                继续追问
              </button>
              {message.modelInfo && (
                <span className="ml-auto text-[10px] text-slate-600">{message.modelInfo}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryView({
  history,
  loading,
  busy,
  currentConversationId,
  onRestore,
  onRemove,
}: {
  readonly history: readonly ConversationRecord[];
  readonly loading: boolean;
  readonly busy: boolean;
  readonly currentConversationId: string;
  readonly onRestore: (record: ConversationRecord) => void;
  readonly onRemove: (record: ConversationRecord) => void;
}) {
  if (loading) {
    return <p className="grid h-full place-items-center text-xs text-slate-500">正在读取对话记录…</p>;
  }
  if (history.length === 0) {
    return (
      <p className="grid h-full place-items-center px-8 text-center text-[13px] leading-6 text-slate-600">
        还没有对话记录。回到“对话”页签开始第一次提问。
      </p>
    );
  }
  return (
    <div className="space-y-2 overflow-y-auto p-3">
      {[...history].sort((left, right) => right.updatedTime - left.updatedTime).map((record) => {
        const firstQuestion = record.messages.find((message) => message.role === 'user');
        const currentIsGenerating = busy && record.id === currentConversationId;
        return (
          <article
            key={record.id}
            className="group rounded-xl border border-white/[0.06] bg-white/[0.025] p-3 hover:border-indigo-300/25 hover:bg-indigo-400/[0.07]"
          >
            <button
              type="button"
              disabled={busy}
              title={busy ? '当前回答完成或停止后可切换对话' : undefined}
              onClick={() => onRestore(record)}
              className="block w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block truncate text-[13px] font-medium text-slate-200">{record.title}</span>
              <span className="mt-1 block line-clamp-2 text-[11px] leading-5 text-slate-500">
                {firstQuestion?.text ?? '（空对话）'}
              </span>
              <span className="mt-2 block text-[9px] text-slate-600">
                {record.messages.length} 条消息 · {new Date(record.updatedTime).toLocaleString('zh-CN')}
              </span>
            </button>
            <div className="mt-2 flex items-center gap-2 border-t border-white/[0.05] pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!busy) onRestore(record);
                }}
                className="text-[11px] text-indigo-300 hover:text-indigo-200"
              >
                查看
              </button>
              <button
                type="button"
                disabled={currentIsGenerating}
                title={currentIsGenerating ? '当前回答生成中，停止后可删除' : undefined}
                onClick={() => onRemove(record)}
                className="text-[11px] text-slate-500 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                删除
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function ConversationPanel({
  state,
  actions,
  projectId,
  resolveContextContribution,
  describeContext,
  onRevealContext,
  onStartNew,
  onClose,
  onOpenSettings,
  onError,
}: {
  readonly state: ConversationControllerState;
  readonly actions: ConversationControllerActions;
  readonly projectId: string;
  readonly resolveContextContribution: (
    source: ConversationMessageContextSource | undefined,
  ) => WorkbenchConversationContribution | undefined;
  readonly describeContext: (
    source: ConversationMessageContextSource,
    context: Exclude<ConversationMessageRecord['context'], undefined>,
  ) => ConversationContextPresentation | undefined;
  readonly onRevealContext: (
    source: ConversationMessageContextSource,
    context: Exclude<ConversationMessageRecord['context'], undefined>,
  ) => Promise<void> | void;
  readonly onStartNew: () => void;
  readonly onClose: () => void;
  readonly onOpenSettings?: () => void;
  readonly onError?: (message: string) => void;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<{ messageId: string; text: string }>();
  const [notice, setNotice] = useState<string>();
  const [answerActionPending, setAnswerActionPending] = useState(false);
  const messages = state.conversation.messages;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, state.activityLabel]);

  useEffect(() => {
    if (state.tab === 'chat') inputRef.current?.focus();
  }, [state.tab]);

  const selectedAnswerMessage = useMemo(
    () => messages.find((message) => message.id === selectedAnswer?.messageId),
    [messages, selectedAnswer?.messageId],
  );
  const selectedAnswerQuestion = selectedAnswerMessage
    ? QuestionForAnswer(state.conversation, selectedAnswerMessage)
    : undefined;
  const selectedAnswerContribution = resolveContextContribution(
    selectedAnswerQuestion?.contextSource,
  );

  const executeAnswerAction = async (
    answer: ConversationMessageRecord,
    text: string,
  ) => {
    const question = QuestionForAnswer(state.conversation, answer);
    const actionContribution = resolveContextContribution(
      question?.contextSource,
    );
    const action = actionContribution?.answerAction;
    if (!action || answerActionPending) return;
    setAnswerActionPending(true);
    try {
      await action.execute({
        projectId,
        assetId: question?.contextSource?.assetId,
        conversation: state.conversation,
        answer,
        question,
        text,
      });
      setSelectedAnswer(undefined);
      setNotice(action.successMessage);
      window.setTimeout(() => setNotice(undefined), 2_000);
    } catch (actionError) {
      setNotice(action.failureMessage);
      onError?.(
        actionError instanceof Error
          ? actionError.message
          : action.failureMessage,
      );
    } finally {
      setAnswerActionPending(false);
    }
  };

  const reportRevealError = (revealError: unknown) => {
    if (revealError instanceof Error && revealError.name === 'AbortError') {
      return;
    }
    const message = revealError instanceof Error
      ? revealError.message
      : '无法在原文中定位该内容。';
    setNotice('定位失败');
    onError?.(message);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    actions.submit();
  };
  const pendingContext = state.pendingContext;
  const pendingContextValue = pendingContext?.context;
  const pendingContextReveal = pendingContext?.contribution.revealContext;

  return (
    <section
      id="project-conversation-panel"
      role="dialog"
      aria-label="AI 问答"
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[17px] border border-white/[0.07] bg-[#1a1f26] shadow-[-20px_0_50px_rgba(0,0,0,0.28)]"
    >
      <header className="shrink-0 border-b border-white/[0.075] px-4 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-[4px] bg-gradient-to-br from-indigo-400 to-fuchsia-400 shadow-[0_0_10px_rgba(129,140,248,0.7)]" />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-100">
              {PROJECT_CONVERSATION_TITLE}
            </h3>
            <p className="truncate text-[10px] text-slate-500">{state.conversation.title}</p>
          </div>
          {notice && <span className="ml-auto text-[10px] text-emerald-300">{notice}</span>}
          <button
            type="button"
            disabled={state.busy}
            onClick={onStartNew}
            className={`${notice ? '' : 'ml-auto '}rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-400 hover:border-indigo-300/30 hover:text-indigo-200 disabled:opacity-40`}
          >
            ＋ 新对话
          </button>
          <button
            type="button"
            aria-label="关闭 AI 问答"
            title={state.busy ? '关闭面板；当前任务会在后台继续' : '关闭 AI 问答'}
            onClick={onClose}
            className="grid size-7 place-items-center rounded-lg text-sm text-slate-500 hover:bg-white/5 hover:text-slate-200"
          >
            ×
          </button>
        </div>
        <nav className="mt-2 flex gap-1" aria-label="AI 问答页签">
          {(['chat', 'history'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => actions.setTab(tab)}
              className={`rounded-t-md px-3 py-1.5 text-[11px] ${
                state.tab === tab
                  ? 'border-b-2 border-indigo-300 text-indigo-200'
                  : 'text-slate-500 hover:text-slate-300'
              } disabled:opacity-40`}
            >
              {tab === 'chat' ? '对话' : `历史${state.history.length ? ` ${state.history.length}` : ''}`}
            </button>
          ))}
        </nav>
      </header>

      {state.tab === 'history' ? (
        <HistoryView
          history={state.history}
          loading={state.historyLoading}
          busy={state.busy}
          currentConversationId={state.conversation.id}
          onRestore={actions.restore}
          onRemove={actions.remove}
        />
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" role="log" aria-label="对话消息">
            {messages.length === 0 && !state.busy && (
              <div className="grid h-full min-h-40 place-items-center px-5 text-center text-[13px] leading-6 text-slate-600">
                {PROJECT_CONVERSATION_EMPTY_LABEL}
              </div>
            )}
            {messages.map((message) => {
              const context = message.context;
              const contextSource = message.contextSource;
              const question =
                message.role === 'assistant'
                  ? QuestionForAnswer(state.conversation, message)
                  : undefined;
              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  contextPresentation={
                    context !== undefined && contextSource
                      ? describeContext(contextSource, context)
                      : undefined
                  }
                  answerContribution={resolveContextContribution(
                    question?.contextSource,
                  )}
                  busy={state.busy}
                  answerActionPending={answerActionPending}
                  onContinue={() => {
                    actions.setDraft(
                      '请基于刚才的回答继续深入解释，并补充容易混淆的地方。',
                    );
                    inputRef.current?.focus();
                  }}
                  onReanswer={(answerId) => actions.reanswer(answerId)}
                  onSelectedAnswer={(messageId, text) =>
                    setSelectedAnswer({ messageId, text })
                  }
                  onAnswerAction={(answer, text) =>
                    void executeAnswerAction(answer, text)
                  }
                  onRevealContext={
                    context !== undefined && contextSource?.assetId
                      ? () =>
                          onRevealContext(contextSource, context)
                      : undefined
                  }
                />
              );
            })}
            {state.busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md border border-white/[0.06] bg-white/[0.045] px-4 py-3 text-[13px] text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="size-3 animate-spin rounded-full border border-slate-500 border-t-indigo-200" />
                    <span>{state.activityLabel ?? '正在等待回答…'}</span>
                    <button
                      type="button"
                      onClick={actions.cancel}
                      className="ml-2 rounded-full border border-rose-300/30 px-2 py-0.5 text-[9px] text-rose-200 hover:bg-rose-300/10"
                    >
                      停止
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <footer className="shrink-0 border-t border-white/[0.075] p-3">
            {state.error && (
              <div role="alert" className="mb-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs leading-5 text-rose-200">
                <p>{state.error.message}</p>
                {state.error.code && (
                  <p className="mt-1 font-mono text-[10px] text-rose-200/60">
                    {state.error.code}
                  </p>
                )}
                <div className="mt-1.5 flex gap-2">
                  {state.error.retryTaskId && (
                    <button type="button" onClick={actions.retry} className="rounded-full border border-rose-300/35 px-2.5 py-0.5 text-[9px] hover:bg-rose-300/10">
                      重试原任务
                    </button>
                  )}
                  {onOpenSettings && needsProviderSettings(state.error.code, state.error.message) && (
                    <button type="button" onClick={onOpenSettings} className="rounded-full border border-white/15 px-2.5 py-0.5 text-[9px] text-slate-200 hover:bg-white/10">
                      打开模型设置
                    </button>
                  )}
                </div>
              </div>
            )}
            {selectedAnswer &&
              selectedAnswerMessage &&
              selectedAnswerContribution?.answerAction && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-indigo-300/20 bg-indigo-400/10 px-3 py-2 text-[10px] text-indigo-200">
                <span className="min-w-0 flex-1 truncate">已选中回答片段</span>
                <button
                  type="button"
                  disabled={answerActionPending}
                  onClick={() =>
                    void executeAnswerAction(
                      selectedAnswerMessage,
                      selectedAnswer.text,
                    )
                  }
                  className="rounded-full bg-indigo-400/20 px-2.5 py-1 hover:bg-indigo-400/30 disabled:opacity-40"
                >
                  {selectedAnswerContribution.answerAction.selectionLabel}
                </button>
                <button type="button" onClick={() => setSelectedAnswer(undefined)} className="text-slate-500">×</button>
              </div>
            )}
            {pendingContext !== undefined && (
              <div className="mb-2">
                <ContextCard
                  presentation={
                    pendingContext.contribution.describeContext?.(
                      pendingContext.context,
                    )
                  }
                  onReveal={
                    pendingContextValue !== undefined && pendingContextReveal
                      ? () => pendingContextReveal(pendingContextValue)
                      : undefined
                  }
                  removable
                  onRemove={() => actions.setPendingContext(undefined)}
                  onRevealError={reportRevealError}
                />
              </div>
            )}
            <form onSubmit={handleSubmit} className="flex items-end gap-2 rounded-xl border border-white/10 bg-black/15 p-2 focus-within:border-indigo-300/35">
              <textarea
                ref={inputRef}
                rows={1}
                value={state.draft}
                disabled={state.busy}
                placeholder={PROJECT_CONVERSATION_INPUT_PLACEHOLDER}
                onChange={(event) => actions.setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    actions.submit();
                  }
                }}
                className="min-h-6 max-h-28 min-w-0 flex-1 resize-none bg-transparent px-1 text-[13px] leading-6 text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-50"
              />
              <button
                type="submit"
                aria-label="发送问题"
                disabled={state.busy || state.draft.trim().length === 0}
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs text-white disabled:opacity-30"
              >
                ➤
              </button>
            </form>
          </footer>
        </>
      )}
    </section>
  );
}
