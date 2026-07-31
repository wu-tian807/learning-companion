import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  createProjectWorkspaceContentRef,
  type AssetSnapshot,
} from '../../shared/assets';
import { WorkbenchRuntimeProvider } from '../workbench/runtime/WorkbenchRuntimeProvider';
import { GenerationCenter } from './GenerationCenter';

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

const actions = {
  onRetry: vi.fn(),
  onSelect: vi.fn(),
  onRename: vi.fn(),
  onReveal: vi.fn(),
  onRelink: vi.fn(),
  onDelete: vi.fn(),
};

describe('GenerationCenter', () => {
  it('renders an explicit empty state without an active Asset', () => {
    const html = renderToStaticMarkup(
      <WorkbenchRuntimeProvider onError={() => undefined}>
        <GenerationCenter
          asset={undefined}
          state={{ kind: 'ready', assets: [] }}
          selectedAssetId={null}
          busy={false}
          now={now}
          mediaLabel={(mediaType) => mediaType}
          {...actions}
        />
      </WorkbenchRuntimeProvider>,
    );

    expect(html).toContain('生成中心');
    expect(html).toContain(
      'data-asset-panel="project-generation-center"',
    );
    expect(html).toContain('选择 Asset 后显示对应工具');
    expect(html).toContain('还没有生成内容');
    expect(html).not.toContain('当前资料上下文');
  });

  it('renders real generated Assets through the shared list', () => {
    const html = renderToStaticMarkup(
      <WorkbenchRuntimeProvider onError={() => undefined}>
        <GenerationCenter
          asset={undefined}
          state={{ kind: 'ready', assets: [generatedAsset] }}
          selectedAssetId="generated"
          busy={false}
          now={now}
          mediaLabel={(mediaType) => mediaType}
          {...actions}
        />
      </WorkbenchRuntimeProvider>,
    );

    expect(html).toContain('1 个内容');
    expect(html).toContain('机器学习知识导图');
    expect(html).toContain('2 days ago');
    expect(html).toContain('机器学习知识导图 的更多操作');
  });
});
