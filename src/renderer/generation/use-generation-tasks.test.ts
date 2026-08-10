import { describe, expect, it, vi } from 'vitest';

import type { GenerationTaskView } from '../../shared/generation-tasks';
import { deliverGenerationTaskCompletion } from './use-generation-tasks';

function completedTask(
  overrides: Partial<GenerationTaskView> = {},
): GenerationTaskView {
  return {
    id: 'task-1',
    projectId: 'project-1',
    definitionId: 'html.assistant',
    definitionVersion: 1,
    status: 'completed',
    metrics: {},
    createdTime: 1,
    updatedTime: 2,
    ...overrides,
  };
}

describe('deliverGenerationTaskCompletion', () => {
  it('delivers an asset-less completed task without reporting an error', async () => {
    const task = completedTask();
    const onCompleted = vi.fn(async () => undefined);
    const onError = vi.fn();

    await deliverGenerationTaskCompletion(task, onCompleted, onError);

    expect(onCompleted).toHaveBeenCalledWith(task);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports an asynchronous consumer failure instead of leaking a rejection', async () => {
    const onError = vi.fn();

    await expect(
      deliverGenerationTaskCompletion(
        completedTask({ result: { resultAssetId: 'asset-1' } }),
        async () => {
          throw new Error('refresh failed');
        },
        onError,
      ),
    ).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(
      '生成任务已完成，但无法处理任务结果。',
    );
  });
});
