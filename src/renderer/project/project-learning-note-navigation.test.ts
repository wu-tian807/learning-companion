import { describe, expect, it, vi } from 'vitest';

import type { AssetAttachment } from '../../shared/attachments/contracts';
import { resolveProjectLearningNoteReference } from './project-learning-note-navigation';

const attachment: AssetAttachment = {
  id: 'attachment-1',
  projectId: 'project-1',
  assetId: 'asset-1',
  typeId: 'epub.ai-explanation',
  typeVersion: 1,
  target: {
    scope: 'content',
    targetType: 'epub.cfi-range',
    targetVersion: 1,
    targetPayload: { cfiRange: 'epubcfi(/6/2!/4/2)' },
  },
  metadata: {},
  createdTime: 1,
  updatedTime: 1,
};

describe('Project learning-note navigation', () => {
  it('resolves the current AssetTarget from the referenced Attachment', async () => {
    const list = vi.fn(async () => [attachment]);
    const result = await resolveProjectLearningNoteReference(
      'project-1',
      {
        projectId: 'project-1',
        assetId: 'asset-1',
        attachmentId: 'attachment-1',
      },
      list,
      new AbortController().signal,
    );

    expect(list).toHaveBeenCalledWith({
      projectId: 'project-1',
      assetId: 'asset-1',
    });
    expect(result).toEqual({
      assetId: 'asset-1',
      target: attachment.target,
    });
  });

  it('keeps legacy direct-target links navigable without querying Attachments', async () => {
    const list = vi.fn(async () => [attachment]);
    if (attachment.target.scope !== 'content') {
      throw new Error('test target must be content-scoped');
    }
    await expect(resolveProjectLearningNoteReference(
      'project-1',
      {
        projectId: 'project-1',
        assetId: 'asset-1',
        sourceRevision: 'revision-1',
        target: attachment.target,
      },
      list,
      new AbortController().signal,
    )).resolves.toEqual({
      assetId: 'asset-1',
      target: attachment.target,
      sourceRevision: 'revision-1',
    });
    expect(list).not.toHaveBeenCalled();
  });

  it('rejects deleted, cross-Project and forged ownership references', async () => {
    const reference = {
      projectId: 'project-1',
      assetId: 'asset-1',
      attachmentId: 'attachment-1',
    } as const;
    await expect(resolveProjectLearningNoteReference(
      'project-1',
      reference,
      async () => [],
      new AbortController().signal,
    )).rejects.toThrow('标注已被删除');
    await expect(resolveProjectLearningNoteReference(
      'other-project',
      reference,
      async () => [attachment],
      new AbortController().signal,
    )).rejects.toThrow('不属于当前 Project');
    await expect(resolveProjectLearningNoteReference(
      'project-1',
      reference,
      async () => [{ ...attachment, assetId: 'forged-asset' }],
      new AbortController().signal,
    )).rejects.toThrow('标注已被删除');
  });

  it('does not return a late Attachment result after navigation is cancelled', async () => {
    const controller = new AbortController();
    let resolveList!: (attachments: readonly AssetAttachment[]) => void;
    const list = () => new Promise<readonly AssetAttachment[]>((resolve) => {
      resolveList = resolve;
    });
    const resolving = resolveProjectLearningNoteReference(
      'project-1',
      {
        projectId: 'project-1',
        assetId: 'asset-1',
        attachmentId: 'attachment-1',
      },
      list,
      controller.signal,
    );
    controller.abort(new DOMException('cancelled', 'AbortError'));
    resolveList([attachment]);

    await expect(resolving).rejects.toMatchObject({ name: 'AbortError' });
  });
});
