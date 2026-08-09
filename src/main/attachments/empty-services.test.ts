import { describe, expect, it } from 'vitest';

import type { CreateAttachmentInput } from './attachment-service';
import { EmptyAttachmentService } from './attachment-service';

const attachmentInput: CreateAttachmentInput = {
  projectId: 'project',
  assetId: 'asset',
  typeId: 'user-note',
  typeVersion: 1,
  target: { scope: 'asset' },
  metadata: { text: '笔记' },
};

describe('EmptyAttachmentService', () => {
  it('returns empty reads without pretending persistence exists', async () => {
    await expect(
      new EmptyAttachmentService().listByAsset('project', 'asset'),
    ).resolves.toEqual([]);
  });

  it('returns an explicit unsupported error for writes', async () => {
    await expect(
      new EmptyAttachmentService().create(attachmentInput),
    ).rejects.toThrow('FEATURE_NOT_SUPPORTED');
  });
});
