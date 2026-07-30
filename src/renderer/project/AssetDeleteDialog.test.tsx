import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  createAbsoluteLocalFileContentRef,
  type AssetSnapshot,
} from '../../shared/assets';
import { AssetDeleteDialog } from './AssetDeleteDialog';

function createAsset(id: string, name: string): AssetSnapshot {
  return {
    id,
    projectId: 'project',
    name,
    mediaType: 'text/plain',
    contentRef: createAbsoluteLocalFileContentRef(`/tmp/${id}.txt`),
    contentStatus: {
      availability: 'available',
      checkedTime: 100,
    },
    createdTime: 100,
    lastUsedTime: 100,
  };
}

describe('AssetDeleteDialog', () => {
  it('describes a single removal without deleting the source file', () => {
    const markup = renderToStaticMarkup(
      <AssetDeleteDialog
        assets={[createAsset('a', '第一章')]}
        busy={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup).toContain('从 Project 中移除 Asset？');
    expect(markup).toContain('“第一章”的记录');
    expect(markup).toContain('本地原文件不会被删除');
    expect(markup).toContain('确认移除');
  });

  it('shows the selected count and a bounded preview for a batch', () => {
    const assets = [
      createAsset('a', '第一章'),
      createAsset('b', '第二章'),
      createAsset('c', '第三章'),
      createAsset('d', '第四章'),
      createAsset('e', '第五章'),
    ];
    const markup = renderToStaticMarkup(
      <AssetDeleteDialog
        assets={assets}
        busy={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup).toContain('从 Project 中移除 5 个 Asset？');
    expect(markup).toContain('移除 5 项');
    expect(markup).toContain('第一章');
    expect(markup).not.toContain('第五章');
    expect(markup).toContain('以及另外 1 项');
  });
});
