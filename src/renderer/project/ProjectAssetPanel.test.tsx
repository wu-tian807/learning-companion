import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  createAbsoluteLocalFileContentRef,
  type AssetSnapshot,
} from '../../shared/assets';
import { AssetSelectionCoordinatorProvider } from './AssetSelectionCoordinatorProvider';
import { ProjectAssetPanel } from './ProjectAssetPanel';
import type {
  AssetSelection,
  AssetSelectionCoordinator,
} from './use-asset-selection';

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
    updatedTime: Date.parse('2026-07-30T10:00:00.000Z'),
  };
}

function createSelection(
  scope: 'imported' | 'generated',
  active = false,
): AssetSelection {
  const assets = active ? [createAsset()] : [];
  return {
    scope,
    active,
    selectedAssetIds: new Set(assets.map((asset) => asset.id)),
    selectedAssets: assets,
    allSelected: active,
    enter: vi.fn(),
    exit: vi.fn(),
    toggle: vi.fn(),
    toggleAll: vi.fn(),
    replace: vi.fn(),
  };
}

function createCoordinator(
  imported = createSelection('imported'),
): AssetSelectionCoordinator {
  return {
    activeScope: imported.active ? 'imported' : null,
    imported,
    generated: createSelection('generated'),
    clear: vi.fn(),
  };
}

const folderProps = {
  folderState: {
    projectId: 'project',
    folders: [],
    folderPathByAssetId: {},
  },
  currentFolderPath: null,
  onOpenFolder: vi.fn(),
  onCreateFolder: vi.fn(async () => true),
  onRenameFolder: vi.fn(async () => true),
  onMoveFolder: vi.fn(async () => true),
  onDeleteFolder: vi.fn(async () => true),
  onMoveAssets: vi.fn(async () => true),
};

describe('ProjectAssetPanel', () => {
  it('keeps loading and empty states visible', () => {
    const loading = renderToStaticMarkup(
      <AssetSelectionCoordinatorProvider coordinator={createCoordinator()}>
        <ProjectAssetPanel
          {...folderProps}
          state={{ kind: 'loading' }}
          selectedAssetId={null}
          busy={false}
          refreshingAll={false}
          dragging={false}
          now={Date.parse('2026-07-31T10:00:00.000Z')}
          onSelect={vi.fn()}
          onRemoveSelected={vi.fn()}
          onCopyAdd={vi.fn()}
          onLinkAdd={vi.fn()}
          onRetry={vi.fn()}
          onRename={vi.fn()}
          onReveal={vi.fn()}
          onRelink={vi.fn()}
          onRefreshAll={vi.fn()}
          onDelete={vi.fn()}
        />
      </AssetSelectionCoordinatorProvider>,
    );

    expect(loading).toContain('正在加载资料');
    expect(loading).toContain('Project Assets');
    expect(loading).toContain(
      'data-asset-panel="project-assets-panel"',
    );
  });

  it('renders media, source and availability from Asset snapshots', () => {
    const markup = renderToStaticMarkup(
      <AssetSelectionCoordinatorProvider coordinator={createCoordinator()}>
        <ProjectAssetPanel
          {...folderProps}
          state={{ kind: 'ready', assets: [createAsset()] }}
          selectedAssetId="asset"
          busy={false}
          refreshingAll={false}
          dragging={false}
          now={Date.parse('2026-07-31T10:00:00.000Z')}
          onSelect={vi.fn()}
          onRemoveSelected={vi.fn()}
          onCopyAdd={vi.fn()}
          onLinkAdd={vi.fn()}
          onRetry={vi.fn()}
          onRename={vi.fn()}
          onReveal={vi.fn()}
          onRelink={vi.fn()}
          onRefreshAll={vi.fn()}
          onDelete={vi.fn()}
        />
      </AssetSelectionCoordinatorProvider>,
    );

    expect(markup).toContain('学习资料');
    expect(markup).toContain('未知');
    expect(markup).toContain('外部');
    expect(markup).toContain('文件缺失');
  });

  it('replaces row menus with selection controls in selection mode', () => {
    const markup = renderToStaticMarkup(
      <AssetSelectionCoordinatorProvider
        coordinator={createCoordinator(createSelection('imported', true))}
      >
        <ProjectAssetPanel
          {...folderProps}
          state={{ kind: 'ready', assets: [createAsset()] }}
          selectedAssetId="asset"
          busy={false}
          refreshingAll={false}
          dragging={false}
          now={Date.parse('2026-07-31T10:00:00.000Z')}
          onSelect={vi.fn()}
          onRemoveSelected={vi.fn()}
          onCopyAdd={vi.fn()}
          onLinkAdd={vi.fn()}
          onRetry={vi.fn()}
          onRename={vi.fn()}
          onReveal={vi.fn()}
          onRelink={vi.fn()}
          onRefreshAll={vi.fn()}
          onDelete={vi.fn()}
        />
      </AssetSelectionCoordinatorProvider>,
    );

    expect(markup).toContain('Assets');
    expect(markup).toContain('添加资料');
    expect(markup).toContain('刷新全部资料状态');
    expect(markup).toContain('完成');
    expect(markup).toContain('已选 1 项');
    expect(markup).toContain('取消全选');
    expect(markup).toContain('移动到…');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain('的更多操作');
  });

  it('renders only direct child folders with a breadcrumb path', () => {
    const markup = renderToStaticMarkup(
      <AssetSelectionCoordinatorProvider coordinator={createCoordinator()}>
        <ProjectAssetPanel
          {...folderProps}
          folderState={{
            projectId: 'project',
            folders: [
              { projectId: 'project', path: '课程' },
              { projectId: 'project', path: '课程/第一章' },
            ],
            folderPathByAssetId: { asset: '课程/第一章' },
          }}
          currentFolderPath="课程"
          state={{ kind: 'ready', assets: [] }}
          selectedAssetId="asset"
          busy={false}
          refreshingAll={false}
          dragging={false}
          now={Date.parse('2026-07-31T10:00:00.000Z')}
          onSelect={vi.fn()}
          onRemoveSelected={vi.fn()}
          onCopyAdd={vi.fn()}
          onLinkAdd={vi.fn()}
          onRetry={vi.fn()}
          onRename={vi.fn()}
          onReveal={vi.fn()}
          onRelink={vi.fn()}
          onRefreshAll={vi.fn()}
          onDelete={vi.fn()}
        />
      </AssetSelectionCoordinatorProvider>,
    );

    expect(markup).toContain('资料文件夹路径');
    expect(markup).toContain('第一章');
    expect(markup).toContain('1 份资料');
    expect(markup).not.toContain('课程 的更多操作');
  });
});
