/**
 * 竞态校准的纯逻辑（renderer 层，可独立测试）。
 *
 * start IPC 返回可能晚于快 task 完成广播（mock / 缓存恢复 / 快速 Provider）。
 * onAsk 在 start 返回后主动读取一次权威快照；本函数判定该快照是否已进入
 * 终态，让 UI 不依赖已错过的广播事件。
 */
import type { GenerationTaskView } from '../../../shared/generation-tasks';
import { isHtmlAssistantTaskResult } from '../generation/html-assistant-result';

export type ConversationTaskResolution =
  | {
      readonly kind: 'terminal-completed';
      readonly answer: string;
      readonly updatedTime: number;
    }
  | { readonly kind: 'terminal-cancelled' }
  | { readonly kind: 'terminal-failed' }
  /** 任务仍在进行中：继续依赖后续广播事件。 */
  | { readonly kind: 'running' };

/** 判定 start 返回后的权威快照是否已进入终态。 */
export function resolveConversationTask(
  taskId: string,
  snapshot: GenerationTaskView | undefined,
): ConversationTaskResolution {
  if (!snapshot || snapshot.id !== taskId) {
    return { kind: 'running' };
  }

  switch (snapshot.status) {
    case 'completed':
      return isHtmlAssistantTaskResult(snapshot.result)
        ? {
            kind: 'terminal-completed',
            answer: snapshot.result.answer,
            updatedTime: snapshot.updatedTime,
          }
        : { kind: 'terminal-failed' };
    case 'cancelled':
      return { kind: 'terminal-cancelled' };
    case 'failed':
      return { kind: 'terminal-failed' };
    default:
      // created / prepared / processing：仍在进行，交给广播事件。
      return { kind: 'running' };
  }
}
