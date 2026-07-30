import { describe, expect, it } from 'vitest';

import type { AssetAttachment } from '../../shared/workbench/attachment';
import { EmptyAssetRelationService } from '../relations/asset-relation-service';
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

describe('empty extension services', () => {
  it('returns empty reads without pretending persistence exists', async () => {
    await expect(
      new EmptyAttachmentService().listByAsset('asset'),
    ).resolves.toEqual([]);
    await expect(
      new EmptyAssetRelationService().listByAsset('asset'),
    ).resolves.toEqual([]);
  });

  it('returns an explicit unsupported error for writes', async () => {
    await expect(
      new EmptyAttachmentService().create(attachment),
    ).rejects.toThrow('FEATURE_NOT_SUPPORTED');
    await expect(
      new EmptyAssetRelationService().delete('relation'),
    ).rejects.toThrow('FEATURE_NOT_SUPPORTED');
  });
});
