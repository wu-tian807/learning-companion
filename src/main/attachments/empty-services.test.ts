import { describe, expect, it } from 'vitest';

import type { AssetAttachment } from '../../shared/workbench/attachment';
import { EmptyAttachmentService } from './attachment-service';

const attachment: AssetAttachment = {
  id: 'attachment',
  projectId: 'project',
  assetId: 'asset',
  typeId: 'user-note',
  typeVersion: 1,
  target: { scope: 'asset' },
  metadata: { text: '笔记' },
  createdTime: Date.parse('2026-07-27T01:00:00.000Z'),
  updatedTime: Date.parse('2026-07-27T01:00:00.000Z'),
};

describe('EmptyAttachmentService', () => {
  it('returns empty reads without pretending persistence exists', async () => {
    await expect(
      new EmptyAttachmentService().listByAsset('asset'),
    ).resolves.toEqual([]);
  });

  it('returns an explicit unsupported error for writes', async () => {
    await expect(
      new EmptyAttachmentService().create(attachment),
    ).rejects.toThrow('FEATURE_NOT_SUPPORTED');
  });
});
