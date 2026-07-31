import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  createProjectWorkspaceContentRef,
  type AssetSnapshot,
} from '../../shared/assets';
import { AssetPanel } from './AssetPanel';

function createAsset(
  id: string,
  name: string,
  updatedTime: number,
): AssetSnapshot {
  return {
    id,
    projectId: 'project',
    name,
    mediaType: 'text/plain',
    creationKind: 'generated',
    contentRef: createProjectWorkspaceContentRef(
      `assets/generated/${id}.txt`,
    ),
    contentStatus: {
      availability: 'available',
      checkedTime: updatedTime,
    },
    createdTime: updatedTime,
    updatedTime,
  };
}

const actions = {
  onSelect: vi.fn(),
  onRename: vi.fn(),
  onReveal: vi.fn(),
  onRelink: vi.fn(),
  onDelete: vi.fn(),
};

describe('AssetPanel', () => {
  it('owns the complete panel shell and sorts every list by update time', () => {
    const older = createAsset('older', '较早内容', 100);
    const newer = createAsset('newer', '最近内容', 200);
    const markup = renderToStaticMarkup(
      <AssetPanel
        id="test-assets"
        ariaLabel="测试内容"
        title="内容面板"
        state={{ kind: 'ready', assets: [older, newer] }}
        listTitle="全部内容"
        loadingLabel="正在加载"
        failedLabel="加载失败"
        emptyState={<p>暂无内容</p>}
        selectedAssetId={null}
        busy={false}
        now={300}
        {...actions}
      />,
    );

    expect(markup).toContain('data-asset-panel="test-assets"');
    expect(markup).toContain('2 项');
    expect(markup).toContain('最近更新 ↓');
    expect(markup.indexOf('最近内容')).toBeLessThan(
      markup.indexOf('较早内容'),
    );
  });
});
