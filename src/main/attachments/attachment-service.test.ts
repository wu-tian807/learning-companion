import { describe, expect, it, vi } from 'vitest';

import type { AssetAttachment } from '../../shared/attachments/contracts';
import { AnchorRegistry } from './anchor-registry';
import type { AttachmentContentFile } from './attachment-content-file';
import type { AttachmentDatabaseApi } from './attachment-database';
import { AttachmentRegistry } from './attachment-registry';
import { AttachmentService } from './attachment-service';

function createHarness() {
  const stored = new Map<string, AssetAttachment>();
  const database: AttachmentDatabaseApi = {
    get: (id) => stored.get(id),
    listByProject: (projectId) =>
      [...stored.values()].filter((item) => item.projectId === projectId),
    listByAsset: (projectId, assetId) =>
      [...stored.values()].filter(
        (item) => item.projectId === projectId && item.assetId === assetId,
      ),
    create: (attachment) => {
      stored.set(attachment.id, attachment);
      return attachment;
    },
    update: (attachment) => {
      stored.set(attachment.id, attachment);
      return attachment;
    },
    delete: (id) => {
      stored.delete(id);
    },
  };
  const attachments = new AttachmentRegistry();
  attachments.register({
    typeId: 'epub.note',
    version: 1,
    isMetadata: (value) =>
      typeof value === 'object' && value !== null && 'status' in value,
  });
  const anchors = new AnchorRegistry();
  anchors.register({
    anchorType: 'epub.cfi-range',
    version: 1,
    isPayload: (value) =>
      typeof value === 'object' && value !== null && 'cfiRange' in value,
  });
  const contentFiles = {
    write: vi.fn(async ({ attachmentId, fileName, mediaType }) => ({
      ref: {
        base: 'project-workspace' as const,
        path: `attachments/${attachmentId}/${fileName}`,
      },
      mediaType,
    })),
    removeAttachment: vi.fn(async () => undefined),
    removeProject: vi.fn(async () => undefined),
  } as unknown as AttachmentContentFile;
  const tracker = { touch: vi.fn() };
  const service = new AttachmentService(
    database,
    attachments,
    anchors,
    contentFiles,
    tracker,
    { createId: () => 'attachment-1', now: () => 10 },
  );
  return { service, stored, contentFiles, tracker };
}

describe('AttachmentService', () => {
  it('owns identity, timestamps, validation and Asset tracking', async () => {
    const { service, tracker } = createHarness();
    const created = await service.create({
      projectId: 'project-1',
      assetId: 'asset-1',
      typeId: 'epub.note',
      typeVersion: 1,
      target: {
        scope: 'content',
        anchorType: 'epub.cfi-range',
        anchorVersion: 1,
        anchorPayload: { cfiRange: 'epubcfi(/6/2)' },
      },
      metadata: { status: 'pending' },
    });

    expect(created).toMatchObject({
      id: 'attachment-1',
      createdTime: 10,
      updatedTime: 10,
    });
    expect(tracker.touch).toHaveBeenCalledWith(
      'project-1',
      'asset-1',
      10,
    );
    await expect(
      service.create({
        projectId: 'project-1',
        assetId: 'asset-1',
        typeId: 'missing',
        typeVersion: 1,
        target: { scope: 'asset' },
        metadata: {},
      }),
    ).rejects.toThrow('ATTACHMENT_TYPE_NOT_REGISTERED');
  });

  it('cleans files and publishes typed deletion events', async () => {
    const { service, contentFiles } = createHarness();
    const created = await service.create({
      projectId: 'project-1',
      assetId: 'asset-1',
      typeId: 'epub.note',
      typeVersion: 1,
      target: { scope: 'asset' },
      metadata: { status: 'pending' },
    });
    const events: unknown[] = [];
    service.subscribe((event) => {
      events.push(event);
    });

    await service.delete('project-1', created.id);

    expect(contentFiles.removeAttachment).toHaveBeenCalledWith(
      'project-1',
      created.id,
    );
    expect(events).toContainEqual({ type: 'deleted', attachment: created });
  });

  it('publishes a file-backed Attachment only after its content is ready', async () => {
    const { service, stored, contentFiles } = createHarness();

    const created = await service.createWithContent({
      projectId: 'project-1',
      assetId: 'asset-1',
      typeId: 'epub.note',
      typeVersion: 1,
      target: { scope: 'asset' },
      metadata: { status: 'completed' },
      content: {
        fileName: 'answer.md',
        mediaType: 'text/markdown',
        data: '# 回答\n',
      },
    });

    expect(contentFiles.write).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: 'attachment-1',
        fileName: 'answer.md',
        content: '# 回答\n',
      }),
    );
    expect(created.content).toEqual({
      ref: {
        base: 'project-workspace',
        kind: 'local-file',
        path: 'attachments/attachment-1/answer.md',
      },
      mediaType: 'text/markdown',
    });
    expect(stored.get(created.id)).toEqual(created);
  });

  it('rolls back both content and database state when Asset tracking fails', async () => {
    const { service, stored, contentFiles, tracker } = createHarness();
    tracker.touch.mockImplementationOnce(() => {
      throw new Error('asset tracking failed');
    });

    await expect(
      service.createWithContent({
        projectId: 'project-1',
        assetId: 'asset-1',
        typeId: 'epub.note',
        typeVersion: 1,
        target: { scope: 'asset' },
        metadata: { status: 'completed' },
        content: {
          fileName: 'answer.md',
          mediaType: 'text/markdown',
          data: '# 回答\n',
        },
      }),
    ).rejects.toThrow('asset tracking failed');

    expect(stored.size).toBe(0);
    expect(contentFiles.removeAttachment).toHaveBeenCalledWith(
      'project-1',
      'attachment-1',
    );
  });

  it('contains rejected async subscribers', async () => {
    const { service } = createHarness();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    service.subscribe(async () => {
      throw new Error('subscriber failed');
    });

    await service.create({
      projectId: 'project-1',
      assetId: 'asset-1',
      typeId: 'epub.note',
      typeVersion: 1,
      target: { scope: 'asset' },
      metadata: { status: 'pending' },
    });
    await Promise.resolve();

    expect(error).toHaveBeenCalledWith(
      '异步 Attachment 事件订阅者执行失败',
      expect.any(Error),
    );
    error.mockRestore();
  });
});
