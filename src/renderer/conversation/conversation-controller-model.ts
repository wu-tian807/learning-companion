import type {
  GenerationExecutionEvent,
  GenerationTaskEvent,
  GenerationTaskView,
} from '../../shared/generation-tasks';
import {
  isIpcErrorPayload,
  userMessageFromError,
} from '../../shared/ipc-error';
import type { JsonValue } from '../../shared/workbench/protocol';
import {
  cloneConversationRecord,
  PROJECT_CONVERSATION_MODE_ID,
  type ConversationWorkspaceBinding,
} from '../../shared/project-conversations';
import type { ConversationRecord } from './conversation-contracts';

export interface ConversationErrorState {
  readonly message: string;
  readonly code?: string;
  readonly retryTaskId?: string;
}

export function defaultCreateConversationId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createConversationRecord(
  id: string,
  now: number,
  options: Readonly<{
    modeId?: string;
    workspace?: ConversationWorkspaceBinding;
  }> = {},
): ConversationRecord {
  return cloneConversationRecord({
    id: `conv-${id}`.slice(0, 128),
    modeId: options.modeId ?? PROJECT_CONVERSATION_MODE_ID,
    ...(options.workspace ? { workspace: options.workspace } : {}),
    title: '新对话',
    messages: Object.freeze([]),
    createdTime: now,
    updatedTime: now,
  });
}

export function createConversationMessageId(id: string): string {
  return `message-${id}`.slice(0, 160);
}

export function fallbackConversationTitle(question: string): string {
  return question.replace(/\s+/gu, ' ').trim().slice(0, 32) || '新对话';
}

export function conversationContextsEqual(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    JSON.stringify(left) === JSON.stringify(right)
  );
}

export function taskSnapshotFromEvent(
  event: GenerationTaskEvent,
): GenerationTaskView | undefined {
  return event.type === 'task-changed' || event.type === 'task-completed'
    ? event.snapshot
    : undefined;
}

export function activityFromExecutionEvent(
  event: GenerationExecutionEvent,
): string | undefined {
  if (event.type === 'phase' && event.state === 'started') {
    return event.phase === 'prepare'
      ? '正在准备资料…'
      : '正在分析并组织回答…';
  }
  if (event.type === 'tool-call' && event.phase === 'started') {
    return `正在使用 ${event.toolName}…`;
  }
  if (event.type === 'status') return event.message;
  return undefined;
}

export function failureFromTask(
  task: GenerationTaskView,
): ConversationErrorState {
  const message =
    task.failure?.detail?.trim() ||
    task.failure?.message?.trim() ||
    (task.status === 'cancelled'
      ? '本次回答已停止。'
      : 'AI 回答失败，请稍后重试。');
  return {
    message,
    ...(task.failure?.code ? { code: task.failure.code } : {}),
    ...(task.status === 'failed' ? { retryTaskId: task.id } : {}),
  };
}

export function failureFromError(
  error: unknown,
  fallback: string,
): ConversationErrorState {
  return {
    message: userMessageFromError(error, fallback) ?? fallback,
    ...(isIpcErrorPayload(error) ? { code: error.code } : {}),
  };
}
