import { useCallback, useEffect, useRef } from 'react';

import { parseWorkbenchLocationHref } from '../../shared/workbench/location-reference';
import { parseProjectLearningNoteTargetHref } from '../../shared/project-learning-notes';
import { selectAndRevealWorkbenchTarget } from '../workbench/host/workbench-target-bridge';
import { clearWorkbenchLocationSnapshot } from '../workbench/location-snapshot-store';

/**
 * Navigation belongs to a Project, not to the Markdown component that happens
 * to contain a link. Selecting a material Asset commonly unmounts that source
 * component before its target controller has registered.
 */
export function useProjectWorkbenchLocationNavigation(
  projectId: string,
  selectMaterialAsset: (assetId: string) => Promise<void> | void,
) {
  const currentRef = useRef<AbortController | undefined>(undefined);

  useEffect(
    () => () => {
      currentRef.current?.abort(
        new DOMException('Project 已关闭。', 'AbortError'),
      );
      clearWorkbenchLocationSnapshot(projectId);
    },
    [projectId],
  );

  return useCallback(
    async (href: string) => {
      const modern = parseWorkbenchLocationHref(href);
      const legacy = modern ? undefined : parseProjectLearningNoteTargetHref(href);
      const reference = modern ?? (legacy
        ? {
            version: 2 as const,
            projectId: legacy.projectId,
            assetId: legacy.assetId,
            target: legacy.target,
            sourceRevision: legacy.sourceRevision,
          }
        : undefined);
      if (!reference || reference.projectId !== projectId) {
        throw new Error('这条位置引用不属于当前 Project。');
      }
      currentRef.current?.abort(
        new DOMException('已开始新的资料定位。', 'AbortError'),
      );
      const controller = new AbortController();
      currentRef.current = controller;
      try {
        await selectAndRevealWorkbenchTarget({
          assetId: reference.assetId,
          target: reference.target,
          ...(reference.sourceRevision
            ? { sourceRevision: reference.sourceRevision }
            : {}),
          selectAsset: selectMaterialAsset,
          signal: controller.signal,
          timeoutMs: 10_000,
          emphasize: true,
          viewportId: 'primary-material',
        });
      } finally {
        if (currentRef.current === controller) {
          currentRef.current = undefined;
        }
      }
    },
    [projectId, selectMaterialAsset],
  );
}
