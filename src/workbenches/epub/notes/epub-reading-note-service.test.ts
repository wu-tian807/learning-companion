import { describe, expect, it, vi } from 'vitest';

import type { AttachmentServiceApi } from '../../../main/attachments/attachment-service';
import type { AssetAttachment } from '../../../shared/attachments/contracts';
import { createEpubCfiRangeTarget } from '../shared';
import { EpubReadingNoteService } from './epub-reading-note-service';

const target = createEpubCfiRangeTarget({
  cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:8)',
  quote: { exact: '值得记录的原文', prefix: '前文', suffix: '后文' },
});

function createNote(): AssetAttachment {
  return {
    id: 'note-1',
    projectId: 'project-1',
    assetId: 'asset-1',
    typeId: 'epub.reading-note',
    typeVersion: 1,
    target,
    metadata: {
      format: 'learning-companion/epub-reading-note',
      version: 1,
      text: '原笔记',
      markerColor: 'yellow',
    },
    createdTime: 1,
    updatedTime: 1,
  };
}

describe('EpubReadingNoteService', () => {
  it('owns create, update and delete through AttachmentService', async () => {
    let stored: AssetAttachment | undefined;
    const create = vi.fn(async (
      input: Parameters<AttachmentServiceApi['create']>[0],
    ) => {
      stored = {
        id: 'note-1',
        ...input,
        createdTime: 1,
        updatedTime: 1,
      };
      return stored;
    });
    const update = vi.fn(async (
      input: Parameters<AttachmentServiceApi['update']>[0],
    ) => {
      stored = {
        ...stored!,
        metadata: input.metadata ?? stored!.metadata,
        updatedTime: 2,
      };
      return stored;
    });
    const remove = vi.fn(async () => {
      stored = undefined;
    });
    const service = new EpubReadingNoteService(
      {
        create,
        get: async () => stored,
        update,
        delete: remove,
      } as unknown as AttachmentServiceApi,
      {
        get: () => ({ mediaType: 'application/epub+zip' }),
      } as never,
    );

    await expect(
      service.create({
        projectId: 'project-1',
        assetId: 'asset-1',
        target,
        text: ' 新笔记 ',
        markerColor: 'red',
      }),
    ).resolves.toMatchObject({
      id: 'note-1',
      text: '新笔记',
      markerColor: 'red',
    });
    expect(create).toHaveBeenCalledWith({
      projectId: 'project-1',
      assetId: 'asset-1',
      typeId: 'epub.reading-note',
      typeVersion: 1,
      target,
      metadata: {
        format: 'learning-companion/epub-reading-note',
        version: 1,
        text: '新笔记',
        markerColor: 'red',
      },
    });

    await expect(
      service.update({
        projectId: 'project-1',
        assetId: 'asset-1',
        noteId: 'note-1',
        text: '修改后',
        markerColor: 'blue',
      }),
    ).resolves.toMatchObject({
      id: 'note-1',
      text: '修改后',
      markerColor: 'blue',
      updatedTime: 2,
    });
    expect(update).toHaveBeenCalledWith({
      projectId: 'project-1',
      attachmentId: 'note-1',
      metadata: {
        format: 'learning-companion/epub-reading-note',
        version: 1,
        text: '修改后',
        markerColor: 'blue',
      },
    });

    await service.delete({
      projectId: 'project-1',
      assetId: 'asset-1',
      noteId: 'note-1',
    });
    expect(remove).toHaveBeenCalledWith('project-1', 'note-1');
  });

  it('rejects cross-Asset and non-note mutations before persistence', async () => {
    const update = vi.fn();
    const service = new EpubReadingNoteService(
      {
        get: async () => createNote(),
        update,
      } as unknown as AttachmentServiceApi,
      {
        get: () => ({ mediaType: 'application/epub+zip' }),
      } as never,
    );

    await expect(
      service.update({
        projectId: 'project-1',
        assetId: 'asset-2',
        noteId: 'note-1',
        text: '越界修改',
        markerColor: 'red',
      }),
    ).rejects.toThrow('ATTACHMENT_NOT_FOUND');
    expect(update).not.toHaveBeenCalled();

    const wrongTypeService = new EpubReadingNoteService(
      {
        get: async () => ({ ...createNote(), typeId: 'epub.ai-explanation' }),
        update,
      } as unknown as AttachmentServiceApi,
      {
        get: () => ({ mediaType: 'application/epub+zip' }),
      } as never,
    );
    await expect(
      wrongTypeService.update({
        projectId: 'project-1',
        assetId: 'asset-1',
        noteId: 'note-1',
        text: '越权修改',
        markerColor: 'red',
      }),
    ).rejects.toThrow('ATTACHMENT_NOT_FOUND');
    expect(update).not.toHaveBeenCalled();
  });
});
