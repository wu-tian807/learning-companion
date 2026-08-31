import { describe, expect, it, vi } from 'vitest';

import type { AssetAttachment } from '../../shared/attachments/contracts';
import type { AttachmentServiceApi } from '../attachments/attachment-service';
import { GenerationTask } from '../generation/generation-task';
import type {
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
} from '../generation/generation-task-service';
import { WorkbenchConversationAttachmentProjection } from './workbench-conversation-attachment-projection';

interface TestTaskView {
  readonly kind: 'task';
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
}

interface TestAttachmentView {
  readonly kind: 'attachment';
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly answer: string;
}

type TestEvent =
  | { readonly type: 'changed'; readonly id: string }
  | { readonly type: 'replaced'; readonly previousId: string; readonly id: string }
  | { readonly type: 'deleted'; readonly id: string };

function taskSnapshot(id = 'task-1') {
  return GenerationTask.create({
    id,
    projectId: 'project-1',
    definitionId: 'test.conversation',
    definitionVersion: 1,
    instruction: {},
    assetReferences: {},
    createdTime: 1,
  }).getSnapshot();
}

function attachment(): AssetAttachment {
  return {
    id: 'attachment-1',
    projectId: 'project-1',
    assetId: 'asset-1',
    typeId: 'test.answer',
    typeVersion: 1,
    target: { scope: 'asset' },
    metadata: {},
    createdTime: 2,
    updatedTime: 2,
  };
}

function setup() {
  let attachmentListener:
    | Parameters<AttachmentServiceApi['subscribe']>[0]
    | undefined;
  let generationListener:
    | Parameters<GenerationTaskServiceApi['subscribe']>[0]
    | undefined;
  const removeAttachments = vi.fn();
  const removeGeneration = vi.fn();
  const storedAttachment = attachment();
  const attachments = {
    get: vi.fn(async (id: string) =>
      id === storedAttachment.id ? storedAttachment : undefined),
    subscribe: vi.fn((listener) => {
      attachmentListener = listener;
      return removeAttachments;
    }),
  } as unknown as AttachmentServiceApi;
  const generationTasks = {
    subscribe: vi.fn((listener) => {
      generationListener = listener;
      return removeGeneration;
    }),
  } as unknown as GenerationTaskServiceApi;
  const projection = new WorkbenchConversationAttachmentProjection<
    AssetAttachment,
    TestTaskView,
    TestAttachmentView,
    TestEvent
  >(attachments, generationTasks, {
    label: '测试投影',
    isAttachment: (value): value is AssetAttachment =>
      value.typeId === 'test.answer',
    locateTask: (snapshot) =>
      snapshot.definitionId === 'test.conversation'
        ? { projectId: snapshot.projectId, assetId: 'asset-1' }
        : undefined,
    toTaskView: (snapshot) => ({
      kind: 'task',
      id: snapshot.id,
      projectId: snapshot.projectId,
      assetId: 'asset-1',
    }),
    toAttachmentView: async (value) => ({
      kind: 'attachment',
      id: value.id,
      projectId: value.projectId,
      assetId: value.assetId,
      answer: '回答',
    }),
    events: {
      changed: (view) => ({ type: 'changed', id: view.id }),
      replaced: (_location, previousId, view) => ({
        type: 'replaced',
        previousId,
        id: view.id,
      }),
      deleted: (_location, id) => ({ type: 'deleted', id }),
    },
  });

  return {
    projection,
    emitAttachment: (event: Parameters<NonNullable<typeof attachmentListener>>[0]) =>
      attachmentListener?.(event),
    emitGeneration: (event: GenerationTaskServiceEvent) =>
      generationListener?.(event),
    storedAttachment,
    removeAttachments,
    removeGeneration,
  };
}

describe('WorkbenchConversationAttachmentProjection', () => {
  it('projects a task change and atomically replaces it with the result Attachment', async () => {
    const { projection, emitGeneration } = setup();
    const events: TestEvent[] = [];
    projection.subscribe((event) => {
      events.push(event);
    });
    const snapshot = taskSnapshot();

    emitGeneration({ type: 'task-changed', snapshot });
    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: 'changed', id: 'task-1' });
    });

    emitGeneration({
      type: 'task-completed',
      snapshot,
      result: {
        taskId: snapshot.id,
        result: {
          answer: '回答',
          providerId: 'provider',
          modelId: 'model',
          contextResult: { attachmentId: 'attachment-1' },
        },
        metrics: snapshot.metrics,
      },
    });
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: 'replaced',
        previousId: 'task-1',
        id: 'attachment-1',
      });
    });
    projection.dispose();
  });

  it('projects Attachment changes and deletes without knowing media semantics', async () => {
    const { projection, emitAttachment, storedAttachment } = setup();
    const events: TestEvent[] = [];
    projection.subscribe((event) => {
      events.push(event);
    });

    emitAttachment({ type: 'changed', attachment: storedAttachment });
    emitAttachment({ type: 'deleted', attachment: storedAttachment });

    await vi.waitFor(() => {
      expect(events).toEqual([
        { type: 'changed', id: 'attachment-1' },
        { type: 'deleted', id: 'attachment-1' },
      ]);
    });
    projection.dispose();
  });

  it('removes tracked discarded tasks and stops publishing after disposal', async () => {
    const {
      projection,
      emitGeneration,
      removeAttachments,
      removeGeneration,
    } = setup();
    const events: TestEvent[] = [];
    projection.subscribe((event) => {
      events.push(event);
    });
    projection.trackTask({
      kind: 'task',
      id: 'task-1',
      projectId: 'project-1',
      assetId: 'asset-1',
    });

    emitGeneration({
      type: 'task-discarded',
      projectId: 'project-1',
      taskId: 'task-1',
      snapshot: taskSnapshot('task-1'),
    });
    await vi.waitFor(() => {
      expect(events).toEqual([{ type: 'deleted', id: 'task-1' }]);
    });

    projection.dispose();
    projection.dispose();
    emitGeneration({ type: 'task-changed', snapshot: taskSnapshot('task-2') });
    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect(removeAttachments).toHaveBeenCalledOnce();
    expect(removeGeneration).toHaveBeenCalledOnce();
  });
});
