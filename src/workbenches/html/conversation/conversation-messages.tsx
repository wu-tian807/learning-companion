/**
 * Pure message rendering for the HTML assistant conversation overlay.
 */
import type { ReactNode } from 'react';

import type { JsonValue } from '../../../shared/workbench/protocol';

export interface ConversationMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly streaming?: boolean;
  /** 该消息绑定的锚点（user 消息提问时携带）。 */
  readonly anchor?: JsonValue;
}

function anchorSummary(anchor: JsonValue): string {
  if (typeof anchor !== 'object' || anchor === null) {
    return '内容';
  }
  const record = anchor as Record<string, unknown>;
  const payload =
    typeof record.anchorPayload === 'object' && record.anchorPayload !== null
      ? (record.anchorPayload as Record<string, unknown>)
      : {};
  if (record.anchorType === 'html.quote') {
    return typeof payload.exact === 'string'
      ? `选中：${payload.exact.slice(0, 24)}`
      : '选中文本';
  }
  if (record.anchorType === 'html.element') {
    return typeof payload.id === 'string' && payload.id
      ? `选中：#${payload.id}`
      : '选中元素';
  }
  if (record.anchorType === 'html.link') {
    return typeof payload.url === 'string' ? `选中：${payload.url}` : '选中链接';
  }
  return '选中内容';
}

function bubbleClass(role: ConversationMessage['role']): string {
  return [
    'max-w-[85%] rounded-[12px] px-3 py-2 text-[11px] leading-6 whitespace-pre-wrap',
    role === 'user'
      ? 'bg-indigo-400/15 border border-indigo-300/20 text-indigo-100 rounded-tr-[4px]'
      : 'bg-white/[0.045] border border-white/[0.055] text-slate-300 rounded-tl-[4px]',
  ].join(' ');
}

export function MessageBubble({ message }: { readonly message: ConversationMessage }) {
  return (
    <div
      className={[
        'flex items-start gap-2',
        message.role === 'user' ? 'flex-row-reverse' : '',
      ].join(' ')}
    >
      <span
        className={[
          'grid size-[26px] shrink-0 place-items-center rounded-[8px] text-[11px]',
          message.role === 'user'
            ? 'bg-indigo-400/25 text-indigo-200'
            : 'bg-indigo-300/15 text-indigo-200',
        ].join(' ')}
        aria-hidden="true"
      >
        {message.role === 'user' ? '你' : 'AI'}
      </span>
      <div className={bubbleClass(message.role)}>
        {message.text}
        {message.streaming && <span className="caret ml-0.5 inline-block h-3 w-[6px] bg-indigo-300 align-[-2px]" />}
      </div>
      {message.anchor && (
        <span className="mt-0.5 block max-w-[85%] text-[9px] text-indigo-300/70">
          {anchorSummary(message.anchor)}
        </span>
      )}
    </div>
  );
}

export function MessageStream({
  messages,
  emptyLabel,
}: {
  readonly messages: readonly ConversationMessage[];
  readonly emptyLabel: string;
}) {
  return (
    <div
      className="msg-stream min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
      role="log"
      aria-label="对话消息"
    >
      {messages.length === 0 ? (
        <p className="grid h-full place-items-center text-center text-[10px] leading-6 text-slate-600">
          {emptyLabel}
        </p>
      ) : (
        messages.map((message) => <MessageBubble key={message.id} message={message} />)
      )}
    </div>
  );
}

export function ErrorBubble({
  text,
  onRetry,
}: {
  readonly text: string;
  readonly onRetry: () => void;
}): ReactNode {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-[10px] text-rose-200">
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-full border border-rose-300/40 px-2.5 py-1 text-[9px] text-rose-200 hover:bg-rose-300/15"
      >
        重试
      </button>
    </div>
  );
}
