import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  MIND_MAP_GENERATION_INSTRUCTION_FORMAT,
  MIND_MAP_GENERATION_INSTRUCTION_VERSION,
  MIND_MAP_GENERATION_TASK_DEFINITION_ID,
  MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
} from '../../shared/generation-definitions';
import {
  isGenerationTaskView,
  isGenerationTaskViewList,
  type GenerationExecutionEvent,
  type GenerationTaskFailureView,
  type GenerationTaskView,
} from '../../shared/generation-tasks';
import { userMessageFromError } from '../../shared/ipc-error';
import type { MindMapGenerationDraft } from './mind-map-generation-draft';

export interface GenerationTaskPresentation {
  readonly task: GenerationTaskView;
  readonly statusLabel: string;
}

interface UseGenerationTasksOptions {
  readonly projectId: string;
  readonly enabled: boolean;
  /**
   * 任务完成后回调，传入完整任务快照（含 result）。
   * 产物解读（resultAssetId 等）是各任务自己的事，hook 不做任何假设。
   */
  readonly onCompleted: (
    task: GenerationTaskView,
  ) => Promise<void> | void;
  readonly onError: (message: string) => void;
}

export async function deliverGenerationTaskCompletion(
  task: GenerationTaskView,
  onCompleted: (task: GenerationTaskView) => Promise<void> | void,
  onError: (message: string) => void,
): Promise<void> {
  try {
    await onCompleted(task);
  } catch (error) {
    const message = userMessageFromError(
      error,
      '生成任务已完成，但无法处理任务结果。',
    );
    if (message) {
      onError(message);
    }
  }
}

function upsertTask(
  tasks: readonly GenerationTaskView[],
  next: GenerationTaskView,
): GenerationTaskView[] {
  const index = tasks.findIndex(({ id }) => id === next.id);

  if (index < 0) {
    return [...tasks, next];
  }

  if (tasks[index]!.updatedTime > next.updatedTime) {
    return [...tasks];
  }

  const updated = [...tasks];
  updated[index] = next;
  return updated;
}

function executionLabel(event: GenerationExecutionEvent): string | undefined {
  if (event.type === 'phase') {
    if (event.state === 'completed') {
      return undefined;
    }

    return {
      prepare: '正在准备资料…',
      process: '正在生成思维导图…',
    }[event.phase];
  }

  if (event.type === 'status') {
    return event.message;
  }

  if (event.type === 'tool-call') {
    return event.phase === 'started'
      ? `正在使用 ${event.toolName}…`
      : undefined;
  }

  if (event.type === 'output-rejected') {
    return `正在修复输出结构（${event.repairTurnNumber}）…`;
  }

  return undefined;
}

function clearsExecutionLabel(event: GenerationExecutionEvent): boolean {
  return (
    (event.type === 'phase' && event.state === 'completed') ||
    (event.type === 'tool-call' && event.phase === 'completed')
  );
}

function defaultStatusLabel(task: GenerationTaskView): string {
  if (task.failure) {
    return task.failure.detail ?? task.failure.message;
  }

  return {
    created: '等待开始…',
    prepared: '资料准备完成…',
    processing: '正在生成思维导图…',
    completed: '生成完成',
    failed: '生成失败',
    cancelled: '已取消',
  }[task.status];
}

function failureDialogMessage(failure: GenerationTaskFailureView): string {
  return failure.detail
    ? `${failure.message}\n${failure.detail}`
    : failure.message;
}

export function useGenerationTasks({
  projectId,
  enabled,
  onCompleted,
  onError,
}: UseGenerationTasksOptions) {
  const [tasks, setTasks] = useState<GenerationTaskView[]>([]);
  const [activityByTask, setActivityByTask] = useState<
    Readonly<Record<string, string>>
  >({});
  const completedIdsRef = useRef(new Set<string>());
  const reportedFailuresRef = useRef(new Set<string>());
  const onCompletedRef = useRef(onCompleted);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onCompletedRef.current = onCompleted;
    onErrorRef.current = onError;
  }, [onCompleted, onError]);

  useEffect(() => {
    let active = true;

    const unsubscribe = window.learningCompanion.onGenerationTaskChanged(
      (event) => {
        if (!active) {
          return;
        }

        if (event.type === 'task-discarded') {
          if (event.projectId === projectId) {
            setTasks((current) =>
              current.filter(({ id }) => id !== event.taskId),
            );
            setActivityByTask((current) => {
              const next = { ...current };
              delete next[event.taskId];
              return next;
            });
          }
          return;
        }

        if (event.type === 'execution-event') {
          if (event.projectId !== projectId) {
            return;
          }

          const label = executionLabel(event.event);
          if (label) {
            setActivityByTask((current) => ({
              ...current,
              [event.taskId]: label,
            }));
          } else if (clearsExecutionLabel(event.event)) {
            setActivityByTask((current) => {
              const next = { ...current };
              delete next[event.taskId];
              return next;
            });
          }
          return;
        }

        const snapshot = event.snapshot;
        if (
          snapshot.projectId !== projectId ||
          snapshot.definitionId !== MIND_MAP_GENERATION_TASK_DEFINITION_ID
        ) {
          return;
        }

        if (event.type === 'task-completed') {
          completedIdsRef.current.add(snapshot.id);
          setTasks((current) =>
            current.filter(({ id }) => id !== snapshot.id),
          );
          setActivityByTask((current) => {
            const next = { ...current };
            delete next[snapshot.id];
            return next;
          });
          // 产物解读交给消费方；共享 Hook 只负责隔离异步消费错误。
          void deliverGenerationTaskCompletion(
            snapshot,
            onCompletedRef.current,
            onErrorRef.current,
          );
          return;
        }

        if (snapshot.status === 'cancelled') {
          setTasks((current) =>
            current.filter(({ id }) => id !== snapshot.id),
          );
          setActivityByTask((current) => {
            const next = { ...current };
            delete next[snapshot.id];
            return next;
          });
          return;
        }

        if (snapshot.failure) {
          const failureKey = `${snapshot.id}:${snapshot.failure.failedTime}`;
          if (!reportedFailuresRef.current.has(failureKey)) {
            reportedFailuresRef.current.add(failureKey);
            onErrorRef.current(failureDialogMessage(snapshot.failure));
          }
          setActivityByTask((current) => {
            const next = { ...current };
            delete next[snapshot.id];
            return next;
          });
        }
        setTasks((current) => upsertTask(current, snapshot));
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [projectId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let active = true;
    void window.learningCompanion
      .listGenerationTasks({ projectId })
      .then((loaded) => {
        if (!active || !isGenerationTaskViewList(loaded)) {
          return;
        }

        setTasks((current) =>
          loaded
            .filter(({ id }) => !completedIdsRef.current.has(id))
            .reduce(upsertTask, current),
        );
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        const message = userMessageFromError(
          error,
          '无法读取生成任务。',
        );
        if (message) {
          onErrorRef.current(message);
        }
      });

    return () => {
      active = false;
    };
  }, [enabled, projectId]);

  const startMindMap = useCallback(
    async (draft: MindMapGenerationDraft) => {
      const started = await window.learningCompanion.startGenerationTask({
        projectId: draft.projectId,
        definitionId: MIND_MAP_GENERATION_TASK_DEFINITION_ID,
        definitionVersion: MIND_MAP_GENERATION_TASK_DEFINITION_VERSION,
        instruction: {
          format: MIND_MAP_GENERATION_INSTRUCTION_FORMAT,
          version: MIND_MAP_GENERATION_INSTRUCTION_VERSION,
          ...(draft.additionalInstructions
            ? { additionalInstructions: draft.additionalInstructions }
            : {}),
        },
        assetReferences: {
          sources: draft.sourceAssetIds.map((assetId) => ({ assetId })),
        },
      });

      if (!isGenerationTaskView(started)) {
        throw new Error('GenerationTask 创建响应无效');
      }
      setTasks((current) => upsertTask(current, started));
    },
    [],
  );

  const retry = useCallback(
    async (taskId: string) => {
      try {
        const retried = await window.learningCompanion.retryGenerationTask({
          projectId,
          taskId,
        });
        if (!isGenerationTaskView(retried)) {
          throw new Error('GenerationTask 重试响应无效');
        }
        setTasks((current) => upsertTask(current, retried));
      } catch (error) {
        const message = userMessageFromError(error, '无法重试生成任务。');
        if (message) {
          onErrorRef.current(message);
        }
      }
    },
    [projectId],
  );

  const cancel = useCallback(
    async (taskId: string) => {
      try {
        await window.learningCompanion.cancelGenerationTask({
          projectId,
          taskId,
        });
        setTasks((current) => current.filter(({ id }) => id !== taskId));
      } catch (error) {
        const message = userMessageFromError(error, '无法取消生成任务。');
        if (message) {
          onErrorRef.current(message);
        }
      }
    },
    [projectId],
  );

  const mindMapTasks = useMemo(
    () =>
      tasks
      .filter(
        ({ definitionId, projectId: taskProjectId }) =>
          taskProjectId === projectId &&
          definitionId === MIND_MAP_GENERATION_TASK_DEFINITION_ID,
      )
      .sort(
        (left, right) =>
          right.updatedTime - left.updatedTime ||
          right.id.localeCompare(left.id),
      )
      .map(
        (task) =>
          ({
            task,
            statusLabel:
              activityByTask[task.id] ?? defaultStatusLabel(task),
          }) satisfies GenerationTaskPresentation,
      ),
    [activityByTask, projectId, tasks],
  );

  return { mindMapTasks, startMindMap, retry, cancel };
}
