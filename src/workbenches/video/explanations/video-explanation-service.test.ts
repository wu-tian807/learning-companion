import { describe, expect, it, vi } from 'vitest';

import type { AttachmentServiceApi } from '../../../main/attachments/attachment-service';
import { WorkbenchConversationInstruction } from '../../../main/conversation/workbench-conversation-instruction';
import { GenerationTask } from '../../../main/generation/generation-task';
import type { GenerationTaskServiceApi } from '../../../main/generation/generation-task-service';
import {
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';
import {
  createVideoConversationContext,
  VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
} from '../conversation/video-conversation-context';
import { createVideoFrameRegionTarget } from '../shared';
import { VideoExplanationService } from './video-explanation-service';

const target = createVideoFrameRegionTarget({
  timeSeconds: 12.5,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  sourceWidth: 1_920,
  sourceHeight: 1_080,
});

function instruction(
  input: {
    readonly question?: string;
    readonly context?: boolean;
    readonly commitAnswer?: boolean;
  } = {},
) {
  return new WorkbenchConversationInstruction({
    contextProviderId: VIDEO_CONVERSATION_CONTEXT_PROVIDER_ID,
    assetId: 'asset-1',
    conversationId: 'conversation-1',
    question: input.question ?? '解释这个公式',
    ...(input.context === false
      ? {}
      : { context: createVideoConversationContext(target, '100') }),
    commitAnswer: input.commitAnswer ?? true,
  });
}

function pendingTask(
  id = 'task-1',
  input: Parameters<typeof instruction>[0] = {},
) {
  return GenerationTask.create({
    id,
    projectId: 'project-1',
    definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
    definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
    instruction: instruction(input).toSnapshot(),
    assetReferences: {},
    createdTime: 2,
  }).getSnapshot();
}

function attachment(sourceRevision = '100') {
  return {
    id: 'attachment-1',
    projectId: 'project-1',
    assetId: 'asset-1',
    typeId: 'video.ai-explanation',
    typeVersion: 1,
    target,
    metadata: {
      format: 'learning-companion/video-explanation',
      version: 1,
      sourceRevision,
      question: '解释这个公式',
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
}

function createService(
  input: {
    readonly attachments?: Partial<AttachmentServiceApi>;
    readonly generationTasks?: Partial<GenerationTaskServiceApi>;
    readonly tasks?: readonly ReturnType<typeof pendingTask>[];
    readonly mediaType?: string;
  } = {},
) {
  const attachments = {
    listByAsset: vi.fn(async () => []),
    readTextContent: vi.fn(async () => '模型回答'),
    subscribe: vi.fn(() => () => undefined),
    ...input.attachments,
  } as unknown as AttachmentServiceApi;
  const generationTasks = {
    list: vi.fn(() => [...(input.tasks ?? [])]),
    getActiveProjectId: vi.fn(() => 'project-1'),
    subscribe: vi.fn(() => () => undefined),
    ...input.generationTasks,
  } as unknown as GenerationTaskServiceApi;
  const service = new VideoExplanationService(attachments, generationTasks, {
    get: vi.fn(() => ({ mediaType: input.mediaType ?? 'video/mp4' })),
  } as never);
  return { service, attachments, generationTasks };
}

describe('VideoExplanationService', () => {
  it('projects only current-revision committed frame tasks and Attachments', async () => {
    const currentTask = pendingTask();
    const followUp = pendingTask('follow-up', {
      context: false,
      commitAnswer: false,
    });
    const { service } = createService({
      attachments: {
        listByAsset: vi.fn(async () => [attachment('99'), attachment('100')]),
      },
      tasks: [currentTask, followUp],
    });

    await expect(
      service.list({
        projectId: 'project-1',
        assetId: 'asset-1',
        sourceRevision: '100',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: 'attachment',
        id: 'attachment-1',
        question: '解释这个公式',
        answer: '模型回答',
      }),
      expect.objectContaining({
        kind: 'task',
        id: 'task-1',
        question: '解释这个公式',
        status: 'pending',
      }),
    ]);
    service.dispose();
  });

  it('cancels pending tasks and deletes completed markers through their owners', async () => {
    const task = pendingTask();
    const cancel = vi.fn();
    const deleteAttachment = vi.fn(async () => undefined);
    const { service } = createService({
      attachments: {
        get: vi.fn(async () => attachment()),
        delete: deleteAttachment,
      },
      generationTasks: {
        get: vi.fn(() => task),
        cancel,
      },
    });

    await service.delete({
      projectId: 'project-1',
      assetId: 'asset-1',
      kind: 'task',
      explanationId: 'task-1',
    });
    await service.delete({
      projectId: 'project-1',
      assetId: 'asset-1',
      kind: 'attachment',
      explanationId: 'attachment-1',
    });

    expect(cancel).toHaveBeenCalledWith('task-1');
    expect(deleteAttachment).toHaveBeenCalledWith('project-1', 'attachment-1');
    service.dispose();
  });

  it('retries and discards the same failed GenerationTask', async () => {
    const failed = new GenerationTask(pendingTask());
    failed.recordFailure({
      phase: 'process',
      failedTime: 3,
      message: '模型请求失败',
    });
    const retry = vi.fn(() => {
      const retried = new GenerationTask(failed.getSnapshot());
      retried.clearFailure(4);
      return retried.getSnapshot();
    });
    const discard = vi.fn();
    const { service } = createService({
      generationTasks: {
        get: vi.fn(() => failed.getSnapshot()),
        retry,
        discard,
      },
    });

    await expect(
      service.retry({
        projectId: 'project-1',
        assetId: 'asset-1',
        kind: 'task',
        explanationId: 'task-1',
      }),
    ).resolves.toMatchObject({ status: 'pending' });
    await service.delete({
      projectId: 'project-1',
      assetId: 'asset-1',
      kind: 'task',
      explanationId: 'task-1',
    });

    expect(retry).toHaveBeenCalledWith('task-1');
    expect(discard).toHaveBeenCalledWith('task-1');
    service.dispose();
  });

  it('rejects non-video assets and a different active project', async () => {
    const nonVideo = createService({ mediaType: 'image/png' });
    await expect(
      nonVideo.service.list({
        projectId: 'project-1',
        assetId: 'asset-1',
        sourceRevision: '100',
      }),
    ).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    nonVideo.service.dispose();

    const wrongProject = createService({
      generationTasks: { getActiveProjectId: vi.fn(() => 'project-2') },
    });
    await expect(
      wrongProject.service.list({
        projectId: 'project-1',
        assetId: 'asset-1',
        sourceRevision: '100',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_CONTEXT_CHANGED' });
    wrongProject.service.dispose();
  });
});
