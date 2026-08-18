import { describe, expect, it, vi } from 'vitest';

import type { AttachmentServiceApi } from '../../../main/attachments/attachment-service';
import { GenerationTask } from '../../../main/generation/generation-task';
import type { GenerationTaskServiceApi } from '../../../main/generation/generation-task-service';
import { createImageRegionTarget } from '../shared';
import { ImageExplanationService } from './image-explanation-service';

const target = createImageRegionTarget({
  x: 0.1, y: 0.2, width: 0.3, height: 0.4,
  sourceWidth: 1000, sourceHeight: 800,
});

describe('ImageExplanationService', () => {
  it('creates one task with the source image bound as an asset reference', async () => {
    const tasks = new Map<string, ReturnType<GenerationTask['getSnapshot']>>();
    const start = vi.fn((request) => {
      const task = GenerationTask.create({
        id: 'task-1',
        projectId: request.projectId,
        definitionId: request.definitionId,
        definitionVersion: request.definitionVersion,
        instruction: request.instruction,
        assetReferences: request.assetReferences,
        createdTime: 1,
      });
      const snapshot = task.getSnapshot();
      tasks.set(snapshot.id, snapshot);
      return snapshot;
    });
    const service = new ImageExplanationService(
      {
        listByAsset: vi.fn(async () => []),
        subscribe: () => () => undefined,
      } as unknown as AttachmentServiceApi,
      { readText: vi.fn() } as never,
      {
        start,
        list: () => [...tasks.values()],
        getActiveProjectId: () => 'project-1',
        subscribe: () => () => undefined,
      } as unknown as GenerationTaskServiceApi,
      { get: () => ({ mediaType: 'image/png' }) } as never,
    );

    const first = await service.create({ projectId: 'project-1', assetId: 'asset-1', target });
    const duplicate = await service.create({ projectId: 'project-1', assetId: 'asset-1', target });

    expect(first).toMatchObject({ kind: 'task', id: 'task-1', status: 'pending', target });
    expect(duplicate.id).toBe('task-1');
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      definitionId: 'image.explain-region',
      assetReferences: { image: [{ assetId: 'asset-1' }] },
    }));
    service.dispose();
  });

  it('rejects non-image assets before creating work', async () => {
    const start = vi.fn();
    const service = new ImageExplanationService(
      { subscribe: () => () => undefined } as unknown as AttachmentServiceApi,
      {} as never,
      {
        start,
        getActiveProjectId: () => 'project-1',
        subscribe: () => () => undefined,
      } as unknown as GenerationTaskServiceApi,
      { get: () => ({ mediaType: 'text/plain' }) } as never,
    );
    await expect(service.create({ projectId: 'project-1', assetId: 'asset-1', target }))
      .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    expect(start).not.toHaveBeenCalled();
    service.dispose();
  });
});
