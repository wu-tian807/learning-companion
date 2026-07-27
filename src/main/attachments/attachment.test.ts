import { describe, expect, it } from 'vitest';

import type { AssetAttachment } from '../../shared/workbench/attachment';
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
    payload: { text: '笔记' },
    target: { scope: 'asset' },
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
  });

  it('rejects invalid timestamps', () => {
    expect(() =>
      createAssetAttachment({
        ...createInput(),
        createdTime: Number.NaN,
      }),
    ).toThrow('createdTime 必须是 Unix 毫秒时间戳');
  });
});
