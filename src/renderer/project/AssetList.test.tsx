import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  createProjectWorkspaceContentRef,
  type AssetSnapshot,
} from '../../shared/assets';
import { AssetList } from './AssetList';

const now = Date.parse('2026-07-31T10:00:00.000Z');
const asset: AssetSnapshot = {
  id: 'generated',
  projectId: 'project',
  name: '知识导图',
  mediaType: 'text/html',
  creationKind: 'generated',
  contentRef: createProjectWorkspaceContentRef(
    'assets/generated/map.html',
  ),
  contentStatus: {
    availability: 'available',
    checkedTime: now,
  },
  createdTime: now - 2 * 24 * 60 * 60_000,
  lastUsedTime: now - 2 * 24 * 60 * 60_000,
};

const actions = {
  onSelect: vi.fn(),
  onRename: vi.fn(),
  onReveal: vi.fn(),
  onRelink: vi.fn(),
  onDelete: vi.fn(),
};

describe('AssetList', () => {
  it('shares Asset presentation, relative time and actions', () => {
    const markup = renderToStaticMarkup(
      <AssetList
        assets={[asset]}
        selectedAssetId="generated"
        busy={false}
        now={now}
        {...actions}
      />,
    );

    expect(markup).toContain('知识导图');
    expect(markup).toContain('HTML');
    expect(markup).toContain('2 days ago');
    expect(markup).toContain('知识导图 的更多操作');
    expect(markup).toContain('bg-indigo-500');
  });

  it('renders the caller-owned empty state', () => {
    const markup = renderToStaticMarkup(
      <AssetList
        assets={[]}
        selectedAssetId={null}
        busy={false}
        now={now}
        emptyState={<p>暂无生成内容</p>}
        {...actions}
      />,
    );

    expect(markup).toContain('暂无生成内容');
  });
});
