import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  createAbsoluteLocalFileContentRef,
  createProjectWorkspaceContentRef,
  type AssetSnapshot,
} from '../../shared/assets';
import { AssetDeleteDialog } from './AssetDeleteDialog';

function createAsset(id: string, name: string): AssetSnapshot {
  return {
    id,
    projectId: 'project',
    name,
    mediaType: 'text/plain',
    creationKind: 'imported',
    contentRef: createAbsoluteLocalFileContentRef(`/tmp/${id}.txt`),
    contentStatus: {
      availability: 'available',
      checkedTime: 100,
    },
    createdTime: 100,
    updatedTime: 100,
  };
}

describe('AssetDeleteDialog', () => {
  it('explains that deleting a linked Asset preserves its source file', () => {
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
    expect(markup).toContain('链接的本地原文件会保留');
    expect(markup).toContain('确认移除');
  });

  it('warns that a copied Asset file is deleted with its record', () => {
    const copiedAsset = {
      ...createAsset('copied', '复制讲义'),
      contentRef: createProjectWorkspaceContentRef(
        '.learning-companion/assets/imported/copied.pdf',
      ),
    };
    const markup = renderToStaticMarkup(
      <AssetDeleteDialog
        assets={[copiedAsset]}
        busy={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup).toContain('复制到 Project 或由应用生成的文件会一并删除');
    expect(markup).toContain('链接的外部原文件会保留');
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
