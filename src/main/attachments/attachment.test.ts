import { describe, expect, it } from 'vitest';

import {
  createAbsoluteLocalFileContentRef,
  createProjectWorkspaceContentRef,
} from '../../shared/assets';
import type { AssetAttachment } from '../../shared/attachments/contracts';
import {
  cloneAssetAttachment,
  createAssetAttachment,
} from './attachment';

function createInput(): AssetAttachment {
  return {
    id: 'attachment',
    projectId: 'project',
    assetId: 'asset',
    typeId: 'user-note',
    typeVersion: 1,
    target: { scope: 'asset' },
    metadata: { format: 'markdown' },
    content: {
      ref: createProjectWorkspaceContentRef(
        '.learning-companion/attachments/attachment.md',
      ),
      mediaType: 'text/markdown',
    },
    createdTime: Date.parse('2026-07-27T01:00:00.000Z'),
    updatedTime: Date.parse('2026-07-27T02:00:00.000Z'),
  };
}

describe('AssetAttachment', () => {
  it('creates and clones attachments with Unix millisecond timestamps', () => {
    const attachment = createAssetAttachment(createInput());
    const clone = cloneAssetAttachment(attachment);

    expect(attachment.createdTime).toBe(
      Date.parse('2026-07-27T01:00:00.000Z'),
    );
    expect(attachment.updatedTime).toBe(
      Date.parse('2026-07-27T02:00:00.000Z'),
    );
    expect(clone).toEqual(attachment);
    expect(clone).not.toBe(attachment);
    expect(clone.content).not.toBe(attachment.content);
    expect(clone.content?.ref).not.toBe(attachment.content?.ref);
  });

  it('rejects invalid timestamps', () => {
    expect(() =>
      createAssetAttachment({
        ...createInput(),
        createdTime: Number.NaN,
      }),
    ).toThrow('createdTime 必须是 Unix 毫秒时间戳');
  });

  it('allows metadata-only attachments', () => {
    const attachment = createAssetAttachment({
      ...createInput(),
      content: undefined,
    });

    expect(attachment.content).toBeUndefined();
    expect(attachment.metadata).toEqual({ format: 'markdown' });
  });

  it('normalizes a persisted pre-Target attachment at the database boundary', () => {
    const attachment = createAssetAttachment({
      ...createInput(),
      target: {
        scope: 'content',
        anchorType: 'pdf.page',
        anchorVersion: 1,
        anchorPayload: { pageNumber: 3 },
      } as never,
    });

    expect(attachment.target).toEqual({
      scope: 'content',
      targetType: 'pdf.page',
      targetVersion: 1,
      targetPayload: { pageNumber: 3 },
    });
  });

  it('rejects external content references', () => {
    expect(() =>
      createAssetAttachment({
        ...createInput(),
        content: {
          ref: createAbsoluteLocalFileContentRef('/tmp/note.md') as never,
          mediaType: 'text/markdown',
        },
      }),
    ).toThrow('content 必须引用 Project Workspace 文件');
  });
});
