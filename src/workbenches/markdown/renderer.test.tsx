import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vditor', () => ({
  default: vi.fn(),
}));

import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import { MarkdownWorkbenchView } from './renderer';
import {
  DEFAULT_MARKDOWN_WORKBENCH_STATE,
  MARKDOWN_WORKBENCH_ID,
} from './shared';

const asset: AssetSnapshot = {
  id: 'asset',
  projectId: 'project',
  name: '学习笔记',
  mediaType: 'text/markdown',
  creationKind: 'imported',
  contentRef: {
    kind: 'local-file',
    base: 'absolute',
    path: '/tmp/private/notes.md',
  },
  contentStatus: {
    availability: 'available',
    checkedTime: 100,
  },
  createdTime: 100,
  lastUsedTime: 100,
};

function createBootstrap(
  payload: WorkbenchBootstrap['payload'],
): WorkbenchBootstrap {
  return {
    sessionId: 'session',
    workbenchId: MARKDOWN_WORKBENCH_ID,
    protocolVersion: 1,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };
}

function render(payload: WorkbenchBootstrap['payload']) {
  return renderToStaticMarkup(
    <WorkbenchRuntimeProvider onError={vi.fn()}>
      <MarkdownWorkbenchView
        asset={asset}
        bootstrap={createBootstrap(payload)}
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

const basePayload = {
  diskSource: '# 标题\n',
  encoding: 'utf-8',
  lineEnding: 'lf',
  hasByteOrderMark: false,
  revision: 'revision-0',
  state: DEFAULT_MARKDOWN_WORKBENCH_STATE,
} as const;

describe('MarkdownWorkbenchView', () => {
  it('renders the full-height WYSIWYG host without exposing local paths', () => {
    const markup = render(basePayload);

    expect(markup).toContain(
      'aria-label="Markdown 可视化编辑器"',
    );
    expect(markup).toContain('learning-markdown-workbench');
    expect(markup).toContain('正在启动 Markdown 可视化编辑器');
    expect(markup).not.toContain('无法无损往返');
    expect(markup).toContain('UTF-8');
    expect(markup).not.toContain('/tmp/private/notes.md');
  });

  it('renders the CodeMirror source mode as a separate editor', () => {
    const markup = render({
      ...basePayload,
      state: {
        ...DEFAULT_MARKDOWN_WORKBENCH_STATE,
        viewMode: 'source',
        sourceViewState: {
          anchor: 0,
          head: 0,
          scrollTop: 0,
        },
      },
    });

    expect(markup).toContain('aria-label="Markdown 源码编辑器"');
    expect(markup).not.toContain('正在启动 Markdown 可视化编辑器');
  });

  it('rejects an invalid bootstrap payload before mounting an editor', () => {
    const markup = render({
      diskSource: '# 私有内容',
      revision: '',
    });

    expect(markup).toContain('Markdown Workbench 数据无效');
    expect(markup).not.toContain('# 私有内容');
    expect(markup).not.toContain('Markdown 可视化编辑器');
  });
});
