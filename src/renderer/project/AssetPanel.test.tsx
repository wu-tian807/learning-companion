import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  createProjectWorkspaceContentRef,
  type AssetSnapshot,
} from '../../shared/assets';
import { AssetPanel } from './AssetPanel';
import type { AssetSelection } from './use-asset-selection';

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
      `.learning-companion/assets/generated/${id}.txt`,
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

function createSelection(
  active = false,
  assets: readonly AssetSnapshot[] = [],
): AssetSelection {
  return {
    scope: 'generated',
    active,
    selectedAssetIds: new Set(assets.map((asset) => asset.id)),
    selectedAssets: assets,
    allSelected: active && assets.length > 0,
    enter: vi.fn(),
    exit: vi.fn(),
    toggle: vi.fn(),
    toggleAll: vi.fn(),
    replace: vi.fn(),
  };
}

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
        selection={createSelection()}
        onRemoveSelected={vi.fn()}
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

  it('owns the complete selection controls without replacing its toolbar', () => {
    const asset = createAsset('generated', '生成内容', 200);
    const markup = renderToStaticMarkup(
      <AssetPanel
        id="test-assets"
        ariaLabel="测试内容"
        title="内容面板"
        state={{ kind: 'ready', assets: [asset] }}
        toolbar={<p>普通业务工具</p>}
        listTitle="全部内容"
        loadingLabel="正在加载"
        failedLabel="加载失败"
        emptyState={<p>暂无内容</p>}
        selection={createSelection(true, [asset])}
        onRemoveSelected={vi.fn()}
        selectedAssetId={null}
        busy={false}
        now={300}
        {...actions}
      />,
    );

    expect(markup).toContain('普通业务工具');
    expect(markup).toContain('完成');
    expect(markup).toContain('已选 1 项');
    expect(markup).toContain('取消全选');
    expect(markup).toContain('移除');
    expect(markup).not.toContain('的更多操作');
  });
});
