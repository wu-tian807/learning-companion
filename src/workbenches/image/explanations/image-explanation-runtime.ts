import type {
  GenerationExecutionEvent,
  GenerationTaskEvent,
} from '../../../shared/generation-tasks';

const MAX_RUNTIME_ANSWER_LENGTH = 64_000;

export interface ImageExplanationRuntimeView {
  readonly text: string;
  readonly phase: 'waiting' | 'answering' | 'saving';
  readonly statusMessage: string;
}

export type ImageExplanationRuntimeMap = Readonly<
  Record<string, ImageExplanationRuntimeView>
>;

const initialRuntimeView: ImageExplanationRuntimeView = Object.freeze({
  text: '',
  phase: 'waiting',
  statusMessage: '正在理解整张图片与兴趣区域…',
});

function reduceRuntime(
  current: ImageExplanationRuntimeView | undefined,
  event: GenerationExecutionEvent,
): ImageExplanationRuntimeView | undefined {
  const previous = current ?? initialRuntimeView;
  if (event.type === 'assistant-delta') {
    if (!event.delta) return current;
    return Object.freeze({
      text: (previous.text + event.delta).slice(0, MAX_RUNTIME_ANSWER_LENGTH),
      phase: 'answering',
      statusMessage: 'AI 正在结合整图解释兴趣区域…',
    });
  }
  if (event.type === 'assistant-completed') {
    return Object.freeze({
      text: event.text.slice(0, MAX_RUNTIME_ANSWER_LENGTH),
      phase: 'saving',
      statusMessage: '解释已生成，正在保存…',
    });
  }
  if (event.type === 'status') {
    return Object.freeze({ ...previous, statusMessage: event.message });
  }
  if (event.type === 'session-resolved') {
    return Object.freeze({ ...previous, statusMessage: '视觉模型已开始分析…' });
  }
  if (event.type === 'phase' && event.state === 'started') {
    return Object.freeze({
      ...previous,
      statusMessage:
        event.phase === 'prepare'
          ? '正在准备整图、标注图和区域放大图…'
          : '正在理解整张图片与兴趣区域…',
    });
  }
  return current;
}

export function removeImageExplanationRuntime(
  current: ImageExplanationRuntimeMap,
  taskId: string,
): ImageExplanationRuntimeMap {
  if (!(taskId in current)) return current;
  const next = { ...current };
  delete next[taskId];
  return Object.freeze(next);
}

export function projectImageExplanationGenerationEvent(
  current: ImageExplanationRuntimeMap,
  event: GenerationTaskEvent,
  projectId: string,
  trackedTaskIds: ReadonlySet<string>,
): ImageExplanationRuntimeMap {
  if (event.type === 'execution-event') {
    if (event.projectId !== projectId || !trackedTaskIds.has(event.taskId)) return current;
    const next = reduceRuntime(current[event.taskId], event.event);
    return next && next !== current[event.taskId]
      ? Object.freeze({ ...current, [event.taskId]: next })
      : current;
  }
  if (
    event.type === 'task-discarded' &&
    event.projectId === projectId &&
    trackedTaskIds.has(event.taskId)
  ) {
    return removeImageExplanationRuntime(current, event.taskId);
  }
  if (
    event.type === 'task-changed' &&
    event.snapshot.projectId === projectId &&
    event.snapshot.status === 'cancelled' &&
    trackedTaskIds.has(event.snapshot.id)
  ) {
    return removeImageExplanationRuntime(current, event.snapshot.id);
  }
  return current;
}
