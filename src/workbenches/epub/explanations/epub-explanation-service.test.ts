import { describe, expect, it, vi } from 'vitest';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import type { AttachmentServiceApi } from '../../../main/attachments/attachment-service';
import type { GenerationTaskServiceApi } from '../../../main/generation/generation-task-service';
import { createEpubCfiRangeTarget } from '../shared';
import { EpubExplanationService } from './epub-explanation-service';

describe('EpubExplanationService retry', () => {
  it('creates a fresh GenerationTask and Session boundary for every retry', async () => {
    let attachment: AssetAttachment | undefined;
    const attachmentListeners: Array<(event: never) => void> = [];
    const attachments: AttachmentServiceApi = {
      get: async () => attachment,
      listByAsset: async () => (attachment ? [attachment] : []),
      create: async (input) => {
        attachment = {
          ...input,
          id: 'attachment-1',
          createdTime: 1,
          updatedTime: 1,
        };
        return attachment;
      },
      update: async (input) => {
        if (!attachment) throw new Error('missing attachment');
        attachment = {
          ...attachment,
          ...(input.target ? { target: input.target } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
          ...(Object.prototype.hasOwnProperty.call(input, 'content')
            ? { content: input.content ?? undefined }
            : {}),
          updatedTime: attachment.updatedTime + 1,
        };
        return attachment;
      },
      delete: async () => {
        attachment = undefined;
      },
      removeByAsset: async () => undefined,
      removeByProject: async () => undefined,
      subscribe: (listener) => {
        attachmentListeners.push(listener as (event: never) => void);
        return () => undefined;
      },
    };
    let taskNumber = 0;
    const create = vi.fn(() => {
      taskNumber += 1;
      return { id: `task-${taskNumber}` } as ReturnType<
        GenerationTaskServiceApi['create']
      >;
    });
    const retry = vi.fn();
    const generationTasks = {
      create,
      retry,
      discard: vi.fn(),
      cancel: vi.fn(),
      getActiveProjectId: () => 'project-1',
      subscribe: () => () => undefined,
    } as unknown as GenerationTaskServiceApi;
    const service = new EpubExplanationService(
      attachments,
      { readText: vi.fn() } as never,
      generationTasks,
      {
        get: () => ({ mediaType: 'application/epub+zip' }),
      } as never,
    );
    const target = createEpubCfiRangeTarget({
      cfiRange: 'epubcfi(/6/2!/4/2/1:0,/1:4)',
      quote: { exact: '文字', prefix: '前文', suffix: '后文' },
    });
    if (target.scope !== 'content') throw new Error('expected content target');

    const created = await service.create({
      projectId: 'project-1',
      assetId: 'asset-1',
      target: target as never,
    });
    if (!created.taskId) throw new Error('missing generation task');
    if (!attachment) throw new Error('missing attachment');
    attachment = {
      ...attachment,
      metadata: {
        format: 'learning-companion/epub-explanation',
        version: 1,
        status: 'failed',
        taskId: created.taskId,
        failureMessage: '第一次生成失败',
      },
    };
    const retried = await service.retry({
      projectId: 'project-1',
      assetId: 'asset-1',
      explanationId: created.id,
    });

    expect(created.taskId).toBe('task-1');
    expect(retried.taskId).toBe('task-2');
    expect(create).toHaveBeenCalledTimes(2);
    expect(retry).toHaveBeenNthCalledWith(1, 'task-1');
    expect(retry).toHaveBeenNthCalledWith(2, 'task-2');
    service.dispose();
  });

  it('reconciles a pending Attachment when its GenerationTask failed while the UI was absent', async () => {
    let attachment: AssetAttachment = {
      id: 'attachment-1',
      projectId: 'project-1',
      assetId: 'asset-1',
      typeId: 'epub.ai-explanation',
      typeVersion: 1,
      target: createEpubCfiRangeTarget({
        cfiRange: 'epubcfi(/6/2!/4/2/1:0,/1:4)',
        quote: { exact: '文字', prefix: '前文', suffix: '后文' },
      }),
      metadata: {
        format: 'learning-companion/epub-explanation',
        version: 1,
        status: 'pending',
        taskId: 'task-1',
      },
      createdTime: 1,
      updatedTime: 1,
    };
    const update = vi.fn(async (input) => {
      attachment = {
        ...attachment,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        updatedTime: attachment.updatedTime + 1,
      };
      return attachment;
    });
    const service = new EpubExplanationService(
      {
        listByAsset: async () => [attachment],
        update,
        subscribe: () => () => undefined,
      } as unknown as AttachmentServiceApi,
      { readText: vi.fn() } as never,
      {
        getActiveProjectId: () => 'project-1',
        get: () => ({
          id: 'task-1',
          failure: { message: '模型请求失败' },
        }),
        subscribe: () => () => undefined,
      } as unknown as GenerationTaskServiceApi,
      {
        get: () => ({ mediaType: 'application/epub+zip' }),
      } as never,
    );

    const [view] = await service.list({
      projectId: 'project-1',
      assetId: 'asset-1',
    });

    expect(view).toMatchObject({
      status: 'failed',
      taskId: 'task-1',
      failureMessage: '模型请求失败',
    });
    expect(update).toHaveBeenCalledOnce();
    service.dispose();
  });
});
