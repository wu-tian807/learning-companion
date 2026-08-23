import { describe, expect, it, vi } from 'vitest';

import type { AttachmentServiceApi } from '../../../main/attachments/attachment-service';
import { WorkbenchConversationInstruction } from '../../../main/conversation/workbench-conversation-instruction';
import { GenerationTask } from '../../../main/generation/generation-task';
import type { GenerationTaskServiceApi } from '../../../main/generation/generation-task-service';
import {
  WORKBENCH_CONVERSATION_SOURCE_SLOT,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';
import { createImageRegionTarget } from '../shared';
import {
  createImageConversationContext,
  IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
} from './image-conversation-context';
import { ImageExplanationService } from './image-explanation-service';

const target = createImageRegionTarget({
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  sourceWidth: 1000,
  sourceHeight: 800,
});

function createInstruction(
  input: {
    readonly context?: boolean;
    readonly commitAnswer?: boolean;
  } = {},
) {
  return new WorkbenchConversationInstruction({
    contextProviderId: IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
    assetId: 'asset-1',
    conversationId: 'conversation-1',
    question: '请解释这个图片区域。',
    ...(input.context === false
      ? {}
      : { context: createImageConversationContext(target, 'revision-1') }),
    commitAnswer: input.commitAnswer ?? true,
  });
}

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
      {
        start,
        list: () => [...tasks.values()],
        getActiveProjectId: () => 'project-1',
        subscribe: () => () => undefined,
      } as unknown as GenerationTaskServiceApi,
      { get: () => ({ mediaType: 'image/png' }) } as never,
    );

    const first = await service.create({
      projectId: 'project-1',
      assetId: 'asset-1',
      sourceRevision: 'revision-1',
      target,
    });
    const duplicate = await service.create({
      projectId: 'project-1',
      assetId: 'asset-1',
      sourceRevision: 'revision-1',
      target,
    });

    expect(first).toMatchObject({
      kind: 'task',
      id: 'task-1',
      status: 'pending',
      target,
      sourceRevision: 'revision-1',
    });
    expect(duplicate.id).toBe('task-1');
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
        definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
        instruction: expect.objectContaining({
          contextProviderId: IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
          context: expect.objectContaining({ sourceRevision: 'revision-1' }),
        }),
        assetReferences: {
          [WORKBENCH_CONVERSATION_SOURCE_SLOT]: [{ assetId: 'asset-1' }],
        },
      }),
    );
    service.dispose();
  });

  it('rejects non-image assets before creating work', async () => {
    const start = vi.fn();
    const service = new ImageExplanationService(
      { subscribe: () => () => undefined } as unknown as AttachmentServiceApi,
      {
        start,
        getActiveProjectId: () => 'project-1',
        subscribe: () => () => undefined,
      } as unknown as GenerationTaskServiceApi,
      { get: () => ({ mediaType: 'text/plain' }) } as never,
    );
    await expect(
      service.create({
        projectId: 'project-1',
        assetId: 'asset-1',
        sourceRevision: 'revision-1',
        target,
      }),
    ).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    expect(start).not.toHaveBeenCalled();
    service.dispose();
  });

  it('filters stale Attachments and lets the same region be explained for a new source revision', async () => {
    const attachment = (id: string, sourceRevision: string) =>
      ({
        id,
        projectId: 'project-1',
        assetId: 'asset-1',
        typeId: 'image.ai-explanation',
        typeVersion: 1,
        target,
        metadata: {
          format: 'learning-companion/image-explanation',
          version: 1,
          sourceRevision,
        },
        content: {
          ref: {
            kind: 'local-file',
            base: 'project-workspace',
            path: `attachments/${id}/answer.md`,
          },
          mediaType: 'text/markdown',
        },
        createdTime: sourceRevision === 'revision-1' ? 1 : 2,
        updatedTime: sourceRevision === 'revision-1' ? 1 : 2,
      }) as const;
    const attachments = [
      attachment('attachment-old', 'revision-1'),
      attachment('attachment-current', 'revision-2'),
    ];
    const tasks = new Map<string, ReturnType<GenerationTask['getSnapshot']>>();
    const start = vi.fn((request) => {
      const task = GenerationTask.create({
        id: 'task-new-revision',
        projectId: request.projectId,
        definitionId: request.definitionId,
        definitionVersion: request.definitionVersion,
        instruction: request.instruction,
        assetReferences: request.assetReferences,
        createdTime: 3,
      });
      const snapshot = task.getSnapshot();
      tasks.set(snapshot.id, snapshot);
      return snapshot;
    });
    const service = new ImageExplanationService(
      {
        listByAsset: vi.fn(async () => attachments),
        readTextContent: vi.fn(async (_projectId, attachmentId) =>
          attachmentId.includes('current') ? '当前解释' : '旧解释',
        ),
        subscribe: () => () => undefined,
      } as unknown as AttachmentServiceApi,
      {
        start,
        list: () => [...tasks.values()],
        getActiveProjectId: () => 'project-1',
        subscribe: () => () => undefined,
      } as unknown as GenerationTaskServiceApi,
      { get: () => ({ mediaType: 'image/png' }) } as never,
    );

    await expect(
      service.list({
        projectId: 'project-1',
        assetId: 'asset-1',
        sourceRevision: 'revision-2',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'attachment-current',
        answer: '当前解释',
        sourceRevision: 'revision-2',
      }),
    ]);
    await expect(
      service.create({
        projectId: 'project-1',
        assetId: 'asset-1',
        sourceRevision: 'revision-2',
        target,
      }),
    ).resolves.toMatchObject({ id: 'attachment-current' });
    await expect(
      service.create({
        projectId: 'project-1',
        assetId: 'asset-1',
        sourceRevision: 'revision-3',
        target,
      }),
    ).resolves.toMatchObject({
      id: 'task-new-revision',
      kind: 'task',
      sourceRevision: 'revision-3',
    });
    expect(start).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('cancels a pending task when its explanation is deleted', async () => {
    const instruction = createInstruction();
    const task = GenerationTask.create({
      id: 'task-1',
      projectId: 'project-1',
      definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
      definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
      instruction: instruction.toSnapshot(),
      assetReferences: {
        [WORKBENCH_CONVERSATION_SOURCE_SLOT]: [{ assetId: 'asset-1' }],
      },
      createdTime: 1,
    });
    const cancel = vi.fn();
    const service = new ImageExplanationService(
      { subscribe: () => () => undefined } as unknown as AttachmentServiceApi,
      {
        get: () => task.getSnapshot(),
        cancel,
        getActiveProjectId: () => 'project-1',
        subscribe: () => () => undefined,
      } as unknown as GenerationTaskServiceApi,
      { get: () => ({ mediaType: 'image/png' }) } as never,
    );
    await service.delete({
      projectId: 'project-1',
      assetId: 'asset-1',
      kind: 'task',
      explanationId: 'task-1',
    });
    expect(cancel).toHaveBeenCalledWith('task-1');
    service.dispose();
  });

  it('deletes a completed explanation through Attachment ownership', async () => {
    const attachment = {
      id: 'attachment-1',
      projectId: 'project-1',
      assetId: 'asset-1',
      typeId: 'image.ai-explanation',
      typeVersion: 1,
      target,
      metadata: {
        format: 'learning-companion/image-explanation',
        version: 1,
        sourceRevision: 'r1',
      },
      content: {
        ref: {
          kind: 'local-file',
          base: 'project-workspace',
          path: 'attachments/attachment-1/answer.md',
        },
        mediaType: 'text/markdown',
      },
      createdTime: 1,
      updatedTime: 1,
    } as const;
    const deleteAttachment = vi.fn(async () => undefined);
    const service = new ImageExplanationService(
      {
        get: vi.fn(async () => attachment),
        delete: deleteAttachment,
        subscribe: () => () => undefined,
      } as unknown as AttachmentServiceApi,
      {
        getActiveProjectId: () => 'project-1',
        subscribe: () => () => undefined,
      } as unknown as GenerationTaskServiceApi,
      { get: () => ({ mediaType: 'image/png' }) } as never,
    );
    await service.delete({
      projectId: 'project-1',
      assetId: 'asset-1',
      kind: 'attachment',
      explanationId: 'attachment-1',
    });
    expect(deleteAttachment).toHaveBeenCalledWith('project-1', 'attachment-1');
    service.dispose();
  });

  it('does not project a follow-up task in the same Session as another image marker', async () => {
    const instruction = new WorkbenchConversationInstruction({
      contextProviderId: IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: '能换一种方式说明吗？',
    });
    const task = GenerationTask.create({
      id: 'follow-up-task',
      projectId: 'project-1',
      definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
      definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
      instruction: instruction.toSnapshot(),
      assetReferences: {},
      createdTime: 1,
    });
    const service = new ImageExplanationService(
      {
        listByAsset: async () => [],
        subscribe: () => () => undefined,
      } as unknown as AttachmentServiceApi,
      {
        getActiveProjectId: () => 'project-1',
        list: () => [task.getSnapshot()],
        subscribe: () => () => undefined,
      } as unknown as GenerationTaskServiceApi,
      { get: () => ({ mediaType: 'image/png' }) } as never,
    );
    await expect(
      service.list({
        projectId: 'project-1',
        assetId: 'asset-1',
        sourceRevision: 'revision-1',
      }),
    ).resolves.toEqual([]);
    service.dispose();
  });
});
