import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  createProjectWorkspaceContentRef,
  type AssetSnapshot,
} from '../../shared/assets';
import type { GenerationTaskView } from '../../shared/generation-tasks';
import { AssetSelectionCoordinatorProvider } from '../project/AssetSelectionCoordinatorProvider';
import type { AssetLoadState } from '../project/project-asset-view';
import type {
  AssetSelection,
  AssetSelectionCoordinator,
} from '../project/use-asset-selection';
import { WorkbenchRuntimeProvider } from '../workbench/runtime/WorkbenchRuntimeProvider';
import { GenerationCenter } from './GenerationCenter';
import type { GenerationTaskPresentation } from './use-generation-tasks';

const now = Date.parse('2026-07-31T10:00:00.000Z');
const generatedAsset: AssetSnapshot = {
  id: 'generated',
  projectId: 'project',
  name: '机器学习知识导图',
  mediaType: 'text/html',
  creationKind: 'generated',
  contentRef: createProjectWorkspaceContentRef(
    'assets/generated/machine-learning-map.html',
  ),
  contentStatus: {
    availability: 'available',
    checkedTime: now,
  },
  createdTime: now - 2 * 24 * 60 * 60_000,
  updatedTime: now - 2 * 24 * 60 * 60_000,
};
const sourceAsset: AssetSnapshot = {
  ...generatedAsset,
  id: 'source',
  name: '机器学习课程讲义',
  mediaType: 'application/pdf',
  creationKind: 'imported',
};

const actions = {
  onRetry: vi.fn(),
  onSelect: vi.fn(),
  onRename: vi.fn(),
  onReveal: vi.fn(),
  onRelink: vi.fn(),
  onDelete: vi.fn(),
  onRemoveSelected: vi.fn(),
  onRevealSources: vi.fn(),
  onRetryMindMapTask: vi.fn(),
  onCancelMindMapTask: vi.fn(),
};

function createTaskPresentation(
  id: string,
  status: GenerationTaskView['status'],
  updatedTime: number,
): GenerationTaskPresentation {
  const failed = status === 'failed';
  return {
    task: {
      id,
      projectId: 'project',
      definitionId: 'mindmap.generate',
      definitionVersion: 1,
      status,
      metrics: {},
      ...(failed
        ? {
            failure: {
              phase: 'process' as const,
              failedTime: updatedTime,
              message: '生成失败',
            },
          }
        : {}),
      createdTime: updatedTime - 1_000,
      updatedTime,
    },
    statusLabel: failed ? 'AI 请求没有完成' : '正在读取资料…',
  };
}

function createSelection(
  scope: 'imported' | 'generated',
  assets: readonly AssetSnapshot[] = [],
  active = assets.length > 0,
): AssetSelection {
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

function createCoordinator({
  sourceAssets = [],
  generatedSelection = createSelection('generated'),
}: {
  readonly sourceAssets?: readonly AssetSnapshot[];
  readonly generatedSelection?: AssetSelection;
} = {}): AssetSelectionCoordinator {
  const importedSelection = createSelection(
    'imported',
    sourceAssets,
  );

  return {
    activeScope: generatedSelection.active
      ? 'generated'
      : importedSelection.active
        ? 'imported'
        : null,
    imported: importedSelection,
    generated: generatedSelection,
    clear: vi.fn(),
  };
}

interface RenderGenerationCenterOptions {
  readonly sourceAssets?: readonly AssetSnapshot[];
  readonly generatedSelection?: AssetSelection;
  readonly asset?: AssetSnapshot;
  readonly state?: AssetLoadState;
  readonly selectedAssetId?: string | null;
  readonly mindMapTasks?: readonly GenerationTaskPresentation[];
}

function renderGenerationCenter({
  sourceAssets = [],
  generatedSelection,
  asset,
  state = { kind: 'ready', assets: [] },
  selectedAssetId = null,
  mindMapTasks,
}: RenderGenerationCenterOptions = {}) {
  return renderToStaticMarkup(
    <WorkbenchRuntimeProvider onError={() => undefined}>
      <AssetSelectionCoordinatorProvider
        coordinator={createCoordinator({
          sourceAssets,
          ...(generatedSelection ? { generatedSelection } : {}),
        })}
      >
        <GenerationCenter
          projectId="project"
          asset={asset}
          state={state}
          selectedAssetId={selectedAssetId}
          mindMapTasks={mindMapTasks}
          busy={false}
          now={now}
          mediaLabel={(mediaType) => mediaType}
          {...actions}
        />
      </AssetSelectionCoordinatorProvider>
    </WorkbenchRuntimeProvider>,
  );
}

describe('GenerationCenter', () => {
  it('renders an explicit empty state without an active Asset', () => {
    const html = renderGenerationCenter();

    expect(html).toContain('生成中心');
    expect(html).toContain(
      'data-asset-panel="project-generation-center"',
    );
    expect(html).toContain('选择 Asset 后显示对应工具');
    expect(html).toContain('还没有生成内容');
    expect(html).not.toContain('当前资料上下文');
    expect(html).not.toContain('生成中心 Connection');
  });

  it('renders real generated Assets through the shared list', () => {
    const html = renderGenerationCenter({
      state: { kind: 'ready', assets: [generatedAsset] },
      selectedAssetId: 'generated',
    });

    expect(html).toContain('1 个内容');
    expect(html).toContain('机器学习知识导图');
    expect(html).toContain('2 days ago');
    expect(html).toContain('机器学习知识导图 的更多操作');
  });

  it('uses the shared selection controls and keeps generation tools visible', () => {
    const html = renderGenerationCenter({
      state: { kind: 'ready', assets: [generatedAsset] },
      selectedAssetId: 'generated',
      generatedSelection: createSelection(
        'generated',
        [generatedAsset],
      ),
    });

    expect(html).toContain('通用生成工具');
    expect(html).toContain('完成');
    expect(html).toContain('已选 1 项');
    expect(html).toContain('取消全选');
    expect(html).toContain('移除');
    expect(html).not.toContain('的更多操作');
  });

  it('keeps Mind Map actionable and explains when sources are missing', () => {
    const withoutSources = renderGenerationCenter();
    const withSources = renderGenerationCenter({
      sourceAssets: [sourceAsset],
    });
    const mindMapButtonWithoutSources = withoutSources.match(
      /<button[^>]*data-generation-tool="mind-map"[^>]*>/,
    )?.[0];
    const mindMapButtonWithSources = withSources.match(
      /<button[^>]*data-generation-tool="mind-map"[^>]*>/,
    )?.[0];
    const outlineButton = withSources.match(
      /<button[^>]*data-generation-tool="study-outline"[^>]*>/,
    )?.[0];

    expect(mindMapButtonWithoutSources).not.toContain(
      ' disabled=""',
    );
    expect(mindMapButtonWithoutSources).toContain(
      'aria-describedby="mind-map-source-tooltip"',
    );
    expect(withoutSources).toContain('role="tooltip"');
    expect(withoutSources).toContain('至少选择一个 Asset');
    expect(mindMapButtonWithSources).not.toContain(' disabled=""');
    expect(mindMapButtonWithSources).not.toContain(
      'aria-describedby',
    );
    expect(withSources).not.toContain('mind-map-source-tooltip');
    expect(mindMapButtonWithSources).toContain(
      '梳理主题与知识关系',
    );
    expect(outlineButton).toContain(' disabled=""');
  });

  it('shows every active task in the Asset list with retry and cancel actions', () => {
    const html = renderGenerationCenter({
      mindMapTasks: [
        createTaskPresentation('task-running', 'processing', now),
        createTaskPresentation('task-failed', 'failed', now - 1_000),
      ],
    });
    const mindMapButton = html.match(
      /<button[^>]*data-generation-tool="mind-map"[^>]*>/,
    )?.[0];

    expect(html).toContain('2 个内容');
    expect(html).toContain('data-generation-task-id="task-running"');
    expect(html).toContain('data-generation-task-id="task-failed"');
    expect(html).toContain('重试思维导图生成任务');
    expect(html.match(/取消思维导图生成任务/g)).toHaveLength(2);
    expect(html).not.toContain('还没有生成内容');
    expect(mindMapButton).not.toContain(' disabled=""');
  });
});
