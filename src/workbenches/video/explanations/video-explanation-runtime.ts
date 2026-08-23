import type {
  GenerationExecutionEvent,
  GenerationTaskEvent,
} from '../../../shared/generation-tasks';
import { VIDEO_EXPLANATION_ANSWER_MAX_LENGTH } from './shared';

export interface VideoExplanationRuntimeView {
  readonly text: string;
  readonly phase: 'waiting' | 'answering' | 'saving';
  readonly statusMessage: string;
}

export type VideoExplanationRuntimeMap = Readonly<
  Record<string, VideoExplanationRuntimeView>
>;

const initialRuntimeView: VideoExplanationRuntimeView = Object.freeze({
  text: '',
  phase: 'waiting',
  statusMessage: '正在理解当前视频帧与兴趣区域…',
});

function reduceRuntime(
  current: VideoExplanationRuntimeView | undefined,
  event: GenerationExecutionEvent,
): VideoExplanationRuntimeView | undefined {
  const previous = current ?? initialRuntimeView;
  if (event.type === 'assistant-delta') {
    if (!event.delta) return current;
    return Object.freeze({
      text: (previous.text + event.delta).slice(
        0,
        VIDEO_EXPLANATION_ANSWER_MAX_LENGTH,
      ),
      phase: 'answering',
      statusMessage: 'AI 正在结合完整画面解释兴趣区域…',
    });
  }
  if (event.type === 'assistant-completed') {
    return Object.freeze({
      text: event.text.slice(0, VIDEO_EXPLANATION_ANSWER_MAX_LENGTH),
      phase: 'saving',
      statusMessage: '解释已生成，正在保存…',
    });
  }
  if (event.type === 'status') {
    return Object.freeze({ ...previous, statusMessage: event.message });
  }
  if (event.type === 'session-resolved') {
    return Object.freeze({
      ...previous,
      statusMessage: '视觉模型已开始分析…',
    });
  }
  if (event.type === 'phase' && event.state === 'started') {
    return Object.freeze({
      ...previous,
      statusMessage:
        event.phase === 'prepare'
          ? '正在截帧并准备标注画面…'
          : '正在理解当前视频帧与兴趣区域…',
    });
  }
  return current;
}

export function removeVideoExplanationRuntime(
  current: VideoExplanationRuntimeMap,
  taskId: string,
): VideoExplanationRuntimeMap {
  if (!(taskId in current)) return current;
  const next = { ...current };
  delete next[taskId];
  return Object.freeze(next);
}

export function projectVideoExplanationGenerationEvent(
  current: VideoExplanationRuntimeMap,
  event: GenerationTaskEvent,
  projectId: string,
  trackedTaskIds: ReadonlySet<string>,
): VideoExplanationRuntimeMap {
  if (event.type === 'execution-event') {
    if (
      event.projectId !== projectId ||
      !trackedTaskIds.has(event.taskId)
    ) {
      return current;
    }
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
    return removeVideoExplanationRuntime(current, event.taskId);
  }
  if (
    event.type === 'task-changed' &&
    event.snapshot.projectId === projectId &&
    event.snapshot.status === 'cancelled' &&
    trackedTaskIds.has(event.snapshot.id)
  ) {
    return removeVideoExplanationRuntime(current, event.snapshot.id);
  }
  return current;
}
