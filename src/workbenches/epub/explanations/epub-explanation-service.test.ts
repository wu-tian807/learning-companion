import { describe, expect, it, vi } from 'vitest';

import type { AttachmentServiceApi } from '../../../main/attachments/attachment-service';
import { WorkbenchConversationInstruction } from '../../../main/conversation/workbench-conversation-instruction';
import { GenerationTask } from '../../../main/generation/generation-task';
import type { GenerationTaskServiceApi } from '../../../main/generation/generation-task-service';
import { createEpubCfiRangeTarget } from '../shared';
import {
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';
import {
  createEpubConversationContext,
  EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
} from './epub-conversation-context';
import { EpubExplanationService } from './epub-explanation-service';

function createTarget() {
  return createEpubCfiRangeTarget({
    cfiRange: 'epubcfi(/6/2!/4/2/1:0,/1:4)',
    quote: { exact: '文字', prefix: '前文', suffix: '后文' },
  });
}

function createInstruction(input: { readonly commitAnswer?: boolean } = {}) {
  return new WorkbenchConversationInstruction({
    contextProviderId: EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
    assetId: 'asset-1',
    conversationId: 'conversation-1',
    question: '请解释这段话。',
    context: createEpubConversationContext(createTarget()),
    commitAnswer: input.commitAnswer ?? true,
  });
}

describe('EpubExplanationService GenerationTask lifecycle', () => {
  it('does not create a pending Attachment and retries the same GenerationTask', async () => {
    const target = createTarget();
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
    const retry = vi.fn((taskId: string) => {
      const current = tasks.get(taskId);
      if (!current) throw new Error('missing task');
      const task = new GenerationTask(current);
      task.clearFailure(3);
      const snapshot = task.getSnapshot();
      tasks.set(taskId, snapshot);
      return snapshot;
    });
    const attachments = {
      get: vi.fn(async () => undefined),
      listByAsset: vi.fn(async () => []),
      create: vi.fn(),
      createWithContent: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      removeByAsset: vi.fn(),
      removeByProject: vi.fn(),
      subscribe: () => () => undefined,
    } as unknown as AttachmentServiceApi;
    const generationTasks = {
      start,
      retry,
      list: () => [...tasks.values()],
      get: (taskId: string) => tasks.get(taskId),
      getActiveProjectId: () => 'project-1',
      subscribe: () => () => undefined,
    } as unknown as GenerationTaskServiceApi;
    const service = new EpubExplanationService(attachments, generationTasks, {
      get: () => ({ mediaType: 'application/epub+zip' }),
    } as never);

    const created = await service.create({
      projectId: 'project-1',
      assetId: 'asset-1',
      target,
    });
    const failedTask = new GenerationTask(tasks.get('task-1')!);
    failedTask.recordFailure({
      phase: 'process',
      failedTime: 2,
      message: '模型请求失败',
    });
    tasks.set('task-1', failedTask.getSnapshot());
    const retried = await service.retry({
      projectId: 'project-1',
      assetId: 'asset-1',
      kind: 'task',
      explanationId: 'task-1',
    });

    expect(created).toMatchObject({
      kind: 'task',
      id: 'task-1',
      status: 'pending',
      target,
    });
    expect(retried).toMatchObject({
      kind: 'task',
      id: 'task-1',
      status: 'pending',
    });
    expect(start).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledWith('task-1');
    expect(attachments.create).not.toHaveBeenCalled();
    expect(attachments.createWithContent).not.toHaveBeenCalled();
    service.dispose();
  });

  it('restores failed UI state from the unfinished GenerationTask itself', async () => {
    const instruction = createInstruction();
    const task = GenerationTask.create({
      id: 'task-1',
      projectId: 'project-1',
      definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
      definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
      instruction: instruction.toSnapshot(),
      assetReferences: {},
      createdTime: 1,
    });
    task.recordFailure({
      phase: 'process',
      failedTime: 2,
      message: '模型请求失败',
    });
    const service = new EpubExplanationService(
      {
        listByAsset: async () => [],
        subscribe: () => () => undefined,
      } as unknown as AttachmentServiceApi,
      {
        getActiveProjectId: () => 'project-1',
        list: () => [task.getSnapshot()],
        subscribe: () => () => undefined,
      } as unknown as GenerationTaskServiceApi,
      {
        get: () => ({ mediaType: 'application/epub+zip' }),
      } as never,
    );

    const views = await service.list({
      projectId: 'project-1',
      assetId: 'asset-1',
    });

    expect(views).toEqual([
      expect.objectContaining({
        kind: 'task',
        id: 'task-1',
        status: 'failed',
        failureMessage: '模型请求失败',
      }),
    ]);
    service.dispose();
  });

  it('replaces the active task projection with its completed Attachment', async () => {
    const target = createTarget();
    const instruction = createInstruction();
    const task = GenerationTask.create({
      id: 'task-1',
      projectId: 'project-1',
      definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
      definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
      instruction: instruction.toSnapshot(),
      assetReferences: {},
      createdTime: 1,
    });
    const attachment = {
      id: 'attachment-1',
      projectId: 'project-1',
      assetId: 'asset-1',
      typeId: 'epub.ai-explanation',
      typeVersion: 1,
      target,
      metadata: {
        format: 'learning-companion/epub-explanation',
        version: 1,
        markerColor: 'red',
      },
      content: {
        ref: {
          kind: 'local-file',
          base: 'project-workspace',
          path: '.learning-companion/attachments/attachment-1/answer.md',
        },
        mediaType: 'text/markdown',
      },
      createdTime: 2,
      updatedTime: 2,
    } as const;
    let generationListener:
      Parameters<GenerationTaskServiceApi['subscribe']>[0] | undefined;
    const service = new EpubExplanationService(
      {
        get: async (id: string) =>
          id === attachment.id ? attachment : undefined,
        readTextContent: vi.fn(async () => '# 解释\n正文'),
        subscribe: () => () => undefined,
      } as unknown as AttachmentServiceApi,
      {
        getActiveProjectId: () => 'project-1',
        subscribe: (
          listener: Parameters<GenerationTaskServiceApi['subscribe']>[0],
        ) => {
          generationListener = listener;
          return () => undefined;
        },
      } as unknown as GenerationTaskServiceApi,
      {
        get: () => ({ mediaType: 'application/epub+zip' }),
      } as never,
    );
    const replaced = new Promise<unknown>((resolve) => {
      service.subscribe((event) => {
        if (event.type === 'replaced') resolve(event);
      });
    });

    generationListener?.({
      type: 'task-completed',
      snapshot: task.getSnapshot(),
      result: {
        taskId: 'task-1',
        result: {
          answer: '# 解释\n正文',
          providerId: 'codex',
          modelId: 'gpt',
          contextResult: { attachmentId: 'attachment-1' },
        },
        metrics: task.getSnapshot().metrics,
      },
    });

    await expect(replaced).resolves.toMatchObject({
      type: 'replaced',
      previousExplanationId: 'task-1',
      explanation: {
        kind: 'attachment',
        id: 'attachment-1',
        status: 'completed',
        answer: '# 解释\n正文',
        markerColor: 'red',
      },
    });
    service.dispose();
  });

  it('不把同一 Session 中的后续追问投影成新标注', async () => {
    const instruction = new WorkbenchConversationInstruction({
      contextProviderId: EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: '能换一种说法吗？',
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
    const service = new EpubExplanationService(
      {
        listByAsset: async () => [],
        subscribe: () => () => undefined,
      } as unknown as AttachmentServiceApi,
      {
        getActiveProjectId: () => 'project-1',
        list: () => [task.getSnapshot()],
        subscribe: () => () => undefined,
      } as unknown as GenerationTaskServiceApi,
      {
        get: () => ({ mediaType: 'application/epub+zip' }),
      } as never,
    );

    await expect(
      service.list({ projectId: 'project-1', assetId: 'asset-1' }),
    ).resolves.toEqual([]);
    service.dispose();
  });

  it('updates marker color only for an owned EPUB explanation Attachment', async () => {
    const attachment = {
      id: 'attachment-1',
      projectId: 'project-1',
      assetId: 'asset-1',
      typeId: 'epub.ai-explanation',
      typeVersion: 1,
      target: createTarget(),
      metadata: {
        format: 'learning-companion/epub-explanation',
        version: 1,
        markerColor: 'blue',
      },
      content: {
        ref: {
          kind: 'local-file',
          base: 'project-workspace',
          path: '.learning-companion/attachments/attachment-1/answer.md',
        },
        mediaType: 'text/markdown',
      },
      createdTime: 1,
      updatedTime: 1,
    } as const;
    const update = vi.fn(async (
      input: Parameters<AttachmentServiceApi['update']>[0],
    ) => ({
      ...attachment,
      metadata: input.metadata,
      updatedTime: 2,
    }));
    const service = new EpubExplanationService(
      {
        get: async () => attachment,
        update,
        readTextContent: async () => '# 解释',
        subscribe: () => () => undefined,
      } as unknown as AttachmentServiceApi,
      {
        getActiveProjectId: () => 'project-1',
        subscribe: () => () => undefined,
      } as unknown as GenerationTaskServiceApi,
      {
        get: () => ({ mediaType: 'application/epub+zip' }),
      } as never,
    );

    await expect(
      service.updateMarkerColor({
        projectId: 'project-1',
        assetId: 'asset-1',
        explanationId: 'attachment-1',
        markerColor: 'red',
      }),
    ).resolves.toMatchObject({
      id: 'attachment-1',
      markerColor: 'red',
      answer: '# 解释',
      updatedTime: 2,
    });
    expect(update).toHaveBeenCalledWith({
      projectId: 'project-1',
      attachmentId: 'attachment-1',
      metadata: {
        format: 'learning-companion/epub-explanation',
        version: 1,
        markerColor: 'red',
      },
    });

    await expect(
      service.updateMarkerColor({
        projectId: 'project-1',
        assetId: 'asset-2',
        explanationId: 'attachment-1',
        markerColor: 'yellow',
      }),
    ).rejects.toThrow('ATTACHMENT_NOT_FOUND');
    expect(update).toHaveBeenCalledOnce();
    service.dispose();
  });
});
