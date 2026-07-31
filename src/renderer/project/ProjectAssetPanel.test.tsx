import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  createAbsoluteLocalFileContentRef,
  type AssetSnapshot,
} from '../../shared/assets';
import { ProjectAssetPanel } from './ProjectAssetPanel';

function createAsset(): AssetSnapshot {
  return {
    id: 'asset',
    projectId: 'project',
    name: '学习资料',
    mediaType: 'application/octet-stream',
    creationKind: 'imported',
    contentRef: createAbsoluteLocalFileContentRef('/tmp/资料.bin'),
    contentStatus: {
      availability: 'missing',
      checkedTime: Date.parse('2026-07-30T10:00:00.000Z'),
    },
    createdTime: Date.parse('2026-07-30T09:00:00.000Z'),
    lastUsedTime: Date.parse('2026-07-30T10:00:00.000Z'),
  };
}

describe('ProjectAssetPanel', () => {
  it('keeps loading and empty states visible', () => {
    const loading = renderToStaticMarkup(
      <ProjectAssetPanel
        state={{ kind: 'loading' }}
        selectedAssetId={null}
        selectionMode={false}
        selectedAssetIds={new Set()}
        allAssetsSelected={false}
        busy={false}
        refreshingAll={false}
        dragging={false}
        onSelect={vi.fn()}
        onEnterSelectionMode={vi.fn()}
        onExitSelectionMode={vi.fn()}
        onToggleSelection={vi.fn()}
        onToggleAll={vi.fn()}
        onDeleteSelected={vi.fn()}
        onCopyAdd={vi.fn()}
        onLinkAdd={vi.fn()}
        onRetry={vi.fn()}
        onRename={vi.fn()}
        onReveal={vi.fn()}
        onRelink={vi.fn()}
        onRefreshAll={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(loading).toContain('正在加载资料');
    expect(loading).toContain('Project Assets');
  });

  it('renders media, source and availability from Asset snapshots', () => {
    const markup = renderToStaticMarkup(
      <ProjectAssetPanel
        state={{ kind: 'ready', assets: [createAsset()] }}
        selectedAssetId="asset"
        selectionMode={false}
        selectedAssetIds={new Set()}
        allAssetsSelected={false}
        busy={false}
        refreshingAll={false}
        dragging={false}
        onSelect={vi.fn()}
        onEnterSelectionMode={vi.fn()}
        onExitSelectionMode={vi.fn()}
        onToggleSelection={vi.fn()}
        onToggleAll={vi.fn()}
        onDeleteSelected={vi.fn()}
        onCopyAdd={vi.fn()}
        onLinkAdd={vi.fn()}
        onRetry={vi.fn()}
        onRename={vi.fn()}
        onReveal={vi.fn()}
        onRelink={vi.fn()}
        onRefreshAll={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(markup).toContain('学习资料');
    expect(markup).toContain('未知');
    expect(markup).toContain('外部');
    expect(markup).toContain('文件缺失');
  });

  it('replaces row menus with selection controls in selection mode', () => {
    const markup = renderToStaticMarkup(
      <ProjectAssetPanel
        state={{ kind: 'ready', assets: [createAsset()] }}
        selectedAssetId="asset"
        selectionMode
        selectedAssetIds={new Set(['asset'])}
        allAssetsSelected
        busy={false}
        refreshingAll={false}
        dragging={false}
        onSelect={vi.fn()}
        onEnterSelectionMode={vi.fn()}
        onExitSelectionMode={vi.fn()}
        onToggleSelection={vi.fn()}
        onToggleAll={vi.fn()}
        onDeleteSelected={vi.fn()}
        onCopyAdd={vi.fn()}
        onLinkAdd={vi.fn()}
        onRetry={vi.fn()}
        onRename={vi.fn()}
        onReveal={vi.fn()}
        onRelink={vi.fn()}
        onRefreshAll={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(markup).toContain('选择资料');
    expect(markup).toContain('已选 1 项');
    expect(markup).toContain('取消全选');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain('的更多操作');
  });
});
