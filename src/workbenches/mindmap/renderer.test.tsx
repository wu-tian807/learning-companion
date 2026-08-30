import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import {
  MIND_MAP_DOCUMENT_FORMAT,
  MIND_MAP_DOCUMENT_VERSION,
} from './document';
import { MindMapWorkbenchView } from './renderer';
import {
  MIND_MAP_MEDIA_TYPE,
  MIND_MAP_WORKBENCH_ID,
  mindMapWorkbenchManifest,
} from './shared';

const asset: AssetSnapshot = {
  id: 'mindmap',
  projectId: 'project',
  name: '课程导图',
  mediaType: MIND_MAP_MEDIA_TYPE,
  creationKind: 'generated',
  contentRef: {
    kind: 'local-file',
    base: 'project-workspace',
    path: '.learning-companion/assets/generated/course.mindmap',
  },
  contentStatus: {
    availability: 'available',
    checkedTime: 100,
  },
  createdTime: 100,
  updatedTime: 100,
};

function render(payload: WorkbenchBootstrap['payload']) {
  const bootstrap: WorkbenchBootstrap = {
    sessionId: 'session',
    workbenchId: MIND_MAP_WORKBENCH_ID,
    workbenchVersion: mindMapWorkbenchManifest.version,
    protocolVersion: mindMapWorkbenchManifest.protocolVersion,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };

  return renderToStaticMarkup(
    <WorkbenchRuntimeProvider onError={vi.fn()}>
      <MindMapWorkbenchView
        asset={asset}
        bootstrap={bootstrap}
        executeCommand={vi.fn(async () => ({
          payload: { saved: true, savedTime: 100 },
        }))}
        onRelink={vi.fn()}
        onRefresh={vi.fn()}
        onReveal={vi.fn()}
        onInteractionChange={vi.fn()}
        onOpenExternal={vi.fn(async () => undefined)}
        onError={vi.fn()}
      />
    </WorkbenchRuntimeProvider>,
  );
}

const validPayload = {
  document: {
    format: MIND_MAP_DOCUMENT_FORMAT,
    version: MIND_MAP_DOCUMENT_VERSION,
    title: '线性规划',
    rootNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        title: '线性规划',
        focus: '课程总览',
        childIds: ['basis'],
      },
      basis: {
        id: 'basis',
        title: '基与基本解',
        focus: '理解基础定义',
        childIds: [],
      },
    },
    frames: {
      foundations: {
        id: 'foundations',
        title: '基础章节',
        nodeIds: ['root', 'basis'],
      },
    },
    associations: { nodes: {}, frames: {} },
  },
  revision: 'revision-1',
  associations: {
    byNode: {},
    byFrame: {},
    staleBindings: [],
  },
  viewState: { collapsedNodeIds: [] },
} satisfies WorkbenchBootstrap['payload'];

describe('MindMapWorkbenchView', () => {
  it('renders the interactive tree canvas and document summary', () => {
    const markup = render(validPayload);

    expect(markup).toContain('aria-label="Mind Map 工作台"');
    expect(markup).toContain('线性规划');
    expect(markup).toContain('2 个节点 · 1 个范围');
    expect(markup).toContain('aria-label="收起子节点"');
    expect(markup).not.toContain('aria-label="展开子节点"');
    expect(markup).not.toContain('line-clamp');
    expect(markup).not.toContain('.learning-companion/assets/generated');
  });

  it('hides the inline control while a branch is collapsed', () => {
    const markup = render({
      ...validPayload,
      viewState: { collapsedNodeIds: ['root'] },
    });

    expect(markup).not.toContain('aria-label="展开子节点"');
    expect(markup).not.toContain('aria-label="收起子节点"');
  });

  it('rejects an invalid Mind Map bootstrap before mounting React Flow', () => {
    const markup = render({
      ...validPayload,
      document: {
        ...validPayload.document,
        rootNodeId: 'missing',
      },
    });

    expect(markup).toContain('Mind Map Workbench 数据无效');
    expect(markup).not.toContain('aria-label="Mind Map 工作台"');
  });
});
