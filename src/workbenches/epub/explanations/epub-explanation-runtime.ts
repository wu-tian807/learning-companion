import type {
  GenerationExecutionEvent,
  GenerationTaskEvent,
} from '../../../shared/generation-tasks';
import { EPUB_EXPLANATION_ANSWER_MAX_LENGTH } from './shared';

export type EpubExplanationRuntimePhase =
  | 'waiting'
  | 'answering'
  | 'saving';

export interface EpubExplanationRuntimeView {
  readonly text: string;
  readonly phase: EpubExplanationRuntimePhase;
  readonly statusMessage: string;
}

export type EpubExplanationRuntimeMap = Readonly<
  Record<string, EpubExplanationRuntimeView>
>;

const initialRuntimeView: EpubExplanationRuntimeView = Object.freeze({
  text: '',
  phase: 'waiting',
  statusMessage: 'AI 正在解释选中的文字…',
});

function constrainRuntimeText(value: string): string {
  return value.slice(0, EPUB_EXPLANATION_ANSWER_MAX_LENGTH);
}

export function reduceEpubExplanationRuntime(
  current: EpubExplanationRuntimeView | undefined,
  event: GenerationExecutionEvent,
): EpubExplanationRuntimeView | undefined {
  const previous = current ?? initialRuntimeView;

  if (event.type === 'assistant-delta') {
    if (event.delta.length === 0) return current;
    return Object.freeze({
      text: constrainRuntimeText(previous.text + event.delta),
      phase: 'answering',
      statusMessage: 'AI 正在生成解释…',
    });
  }

  if (event.type === 'assistant-completed') {
    return Object.freeze({
      text: constrainRuntimeText(event.text),
      phase: 'saving',
      statusMessage: '回答已生成，正在保存解释…',
    });
  }

  if (event.type === 'status') {
    return Object.freeze({
      ...previous,
      statusMessage: event.message,
    });
  }

  if (event.type === 'session-resolved') {
    return Object.freeze({
      ...previous,
      statusMessage: 'AI 已开始处理选中的文字…',
    });
  }

  if (event.type === 'phase' && event.state === 'started') {
    return Object.freeze({
      ...previous,
      statusMessage:
        event.phase === 'prepare'
          ? '正在准备解释所需的内容…'
          : 'AI 正在解释选中的文字…',
    });
  }

  return current;
}

export function applyEpubExplanationRuntimeEvent(
  current: EpubExplanationRuntimeMap,
  taskId: string,
  event: GenerationExecutionEvent,
): EpubExplanationRuntimeMap {
  const next = reduceEpubExplanationRuntime(current[taskId], event);
  if (!next || next === current[taskId]) return current;
  return Object.freeze({ ...current, [taskId]: next });
}

export function removeEpubExplanationRuntime(
  current: EpubExplanationRuntimeMap,
  taskId: string,
): EpubExplanationRuntimeMap {
  if (!(taskId in current)) return current;
  const next = { ...current };
  delete next[taskId];
  return Object.freeze(next);
}

export function projectEpubExplanationGenerationEvent(
  current: EpubExplanationRuntimeMap,
  event: GenerationTaskEvent,
  projectId: string,
  trackedTaskIds: ReadonlySet<string>,
): EpubExplanationRuntimeMap {
  if (event.type === 'execution-event') {
    return event.projectId === projectId && trackedTaskIds.has(event.taskId)
      ? applyEpubExplanationRuntimeEvent(
          current,
          event.taskId,
          event.event,
        )
      : current;
  }

  if (
    event.type === 'task-discarded' &&
    event.projectId === projectId &&
    trackedTaskIds.has(event.taskId)
  ) {
    return removeEpubExplanationRuntime(current, event.taskId);
  }

  if (
    event.type === 'task-changed' &&
    event.snapshot.projectId === projectId &&
    event.snapshot.status === 'cancelled' &&
    trackedTaskIds.has(event.snapshot.id)
  ) {
    return removeEpubExplanationRuntime(current, event.snapshot.id);
  }

  return current;
}
