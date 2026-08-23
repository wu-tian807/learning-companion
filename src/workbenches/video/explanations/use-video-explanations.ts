import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  projectVideoExplanationGenerationEvent,
  removeVideoExplanationRuntime,
  type VideoExplanationRuntimeMap,
} from './video-explanation-runtime';
import { orderVideoExplanations } from './video-explanation-index';
import type {
  VideoExplanationEvent,
  VideoExplanationView,
} from './shared';
import {
  isVideoExplanationForRevision,
  videoExplanationVisibleAtTime,
} from './video-explanation-revision';

export interface UseVideoExplanationsInput {
  readonly enabled: boolean;
  readonly projectId: string;
  readonly assetId: string;
  readonly sourceRevision: string;
  readonly currentTime: number;
  readonly reportError: (error: unknown, fallback: string) => void;
  readonly revealTarget: (explanation: VideoExplanationView) => boolean;
}

function explanationIdsTouchedByEvent(
  event: VideoExplanationEvent,
): readonly string[] {
  if (event.type === 'changed') return [event.explanation.id];
  if (event.type === 'replaced') {
    return [event.previousExplanationId, event.explanation.id];
  }
  return [event.explanationId];
}

/** Keeps Video explanation state and IPC lifecycle inside the Video Workbench. */
export function useVideoExplanations({
  enabled,
  projectId,
  assetId,
  sourceRevision,
  currentTime,
  reportError,
  revealTarget,
}: UseVideoExplanationsInput) {
  const [items, setItems] = useState<VideoExplanationView[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [indexOpen, setIndexOpen] = useState(false);
  const [markersVisible, setMarkersVisible] = useState(true);
  const taskIdsRef = useRef(new Set<string>());
  const [runtimeByTaskId, setRuntimeByTaskId] =
    useState<VideoExplanationRuntimeMap>({});

  const registerTask = useCallback((explanation: VideoExplanationView) => {
    if (explanation.kind === 'task') taskIdsRef.current.add(explanation.id);
  }, []);
  const clearTaskRuntime = useCallback((taskId: string) => {
    taskIdsRef.current.delete(taskId);
    setRuntimeByTaskId((current) =>
      removeVideoExplanationRuntime(current, taskId),
    );
  }, []);

  useEffect(() => {
    let active = true;
    const touchedIds = new Set<string>();
    setItems([]);
    setActiveId(undefined);
    setIndexOpen(false);
    setRuntimeByTaskId({});
    taskIdsRef.current.clear();
    if (!enabled) return;

    const removeSubscription =
      window.learningCompanion.onVideoExplanationChanged((event) => {
        if (!active) return;
        if (event.type === 'changed') {
          if (
            event.explanation.projectId !== projectId ||
            event.explanation.assetId !== assetId
          ) {
            return;
          }
          for (const id of explanationIdsTouchedByEvent(event)) {
            touchedIds.add(id);
          }
          if (!isVideoExplanationForRevision(event.explanation, sourceRevision)) {
            setItems((current) =>
              current.filter((item) => item.id !== event.explanation.id),
            );
            return;
          }
          registerTask(event.explanation);
          setItems((current) => [
            ...current.filter((item) => item.id !== event.explanation.id),
            event.explanation,
          ]);
          return;
        }
        if (event.type === 'replaced') {
          if (event.projectId !== projectId || event.assetId !== assetId) {
            return;
          }
          for (const id of explanationIdsTouchedByEvent(event)) {
            touchedIds.add(id);
          }
          clearTaskRuntime(event.previousExplanationId);
          const isCurrent = isVideoExplanationForRevision(
            event.explanation,
            sourceRevision,
          );
          setItems((current) => [
            ...current.filter(
              (item) =>
                item.id !== event.previousExplanationId &&
                item.id !== event.explanation.id,
            ),
            ...(isCurrent ? [event.explanation] : []),
          ]);
          setActiveId((current) =>
            current === event.previousExplanationId
              ? isCurrent
                ? event.explanation.id
                : undefined
              : current,
          );
          return;
        }
        if (event.projectId !== projectId || event.assetId !== assetId) {
          return;
        }
        for (const id of explanationIdsTouchedByEvent(event)) {
          touchedIds.add(id);
        }
        clearTaskRuntime(event.explanationId);
        setItems((current) =>
          current.filter((item) => item.id !== event.explanationId),
        );
        setActiveId((current) =>
          current === event.explanationId ? undefined : current,
        );
      });

    void window.learningCompanion
      .listVideoExplanations({ projectId, assetId, sourceRevision })
      .then((loaded) => {
        if (!active) return;
        for (const item of loaded) {
          if (!touchedIds.has(item.id)) registerTask(item);
        }
        setItems((current) => [
          ...loaded.filter((item) => !touchedIds.has(item.id)),
          ...current,
        ]);
      })
      .catch((error: unknown) => {
        if (active) reportError(error, '无法加载视频的 AI 解释。');
      });

    return () => {
      active = false;
      removeSubscription();
      taskIdsRef.current.clear();
    };
  }, [
    assetId,
    clearTaskRuntime,
    enabled,
    projectId,
    registerTask,
    reportError,
    sourceRevision,
  ]);

  useEffect(
    () => {
      if (!enabled) return;
      return window.learningCompanion.onGenerationTaskChanged((event) => {
        setRuntimeByTaskId((current) =>
          projectVideoExplanationGenerationEvent(
            current,
            event,
            projectId,
            taskIdsRef.current,
          ),
        );
      });
    },
    [enabled, projectId],
  );

  const retry = useCallback(
    async (explanation: VideoExplanationView) => {
      setRuntimeByTaskId((current) =>
        removeVideoExplanationRuntime(current, explanation.id),
      );
      try {
        const retried = await window.learningCompanion.retryVideoExplanation({
          projectId,
          assetId,
          kind: explanation.kind,
          explanationId: explanation.id,
        });
        setItems((current) => [
          ...current.filter((item) => item.id !== retried.id),
          retried,
        ]);
        registerTask(retried);
      } catch (error) {
        reportError(error, '无法重试视频 AI 解释。');
      }
    },
    [assetId, projectId, registerTask, reportError],
  );

  const remove = useCallback(
    async (explanation: VideoExplanationView) => {
      try {
        await window.learningCompanion.deleteVideoExplanation({
          projectId,
          assetId,
          kind: explanation.kind,
          explanationId: explanation.id,
        });
        clearTaskRuntime(explanation.id);
        setItems((current) =>
          current.filter((item) => item.id !== explanation.id),
        );
        setActiveId((current) =>
          current === explanation.id ? undefined : current,
        );
      } catch (error) {
        reportError(error, '无法删除视频 AI 解释。');
      }
    },
    [assetId, clearTaskRuntime, projectId, reportError],
  );

  const reveal = useCallback(
    (explanation: VideoExplanationView) => {
      if (!revealTarget(explanation)) return;
      setActiveId(explanation.id);
      setIndexOpen(false);
    },
    [revealTarget],
  );
  const toggleIndex = useCallback(() => {
    setActiveId(undefined);
    setIndexOpen((current) => !current);
  }, []);
  const toggleMarkers = useCallback(() => {
    setMarkersVisible((current) => !current);
  }, []);
  const ordered = useMemo(() => orderVideoExplanations(items), [items]);
  const active = items.find((item) => item.id === activeId);
  const markers = useMemo(
    () =>
      ordered
        .map((explanation, index) => ({ explanation, number: index + 1 }))
        .filter(({ explanation }) =>
          videoExplanationVisibleAtTime(explanation, currentTime),
        ),
    [currentTime, ordered],
  );

  useEffect(() => {
    if (items.length === 0) setMarkersVisible(true);
  }, [items.length]);

  const closeIndex = useCallback(() => setIndexOpen(false), []);
  const closeActive = useCallback(() => setActiveId(undefined), []);

  return Object.freeze({
    items,
    ordered,
    active,
    indexOpen,
    markersVisible,
    markers,
    runtimeByTaskId,
    retry,
    remove,
    reveal,
    toggleIndex,
    toggleMarkers,
    closeIndex,
    closeActive,
  });
}
