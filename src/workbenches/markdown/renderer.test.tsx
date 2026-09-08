import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vditor', () => ({
  default: vi.fn(),
}));

import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import { WorkbenchConversationRuntimeProvider } from '../../renderer/conversation/WorkbenchConversationRuntimeProvider';
import { markdownLocationHrefAt, MarkdownWorkbenchView } from './renderer';
import { createWorkbenchLocationHref } from '../../shared/workbench/location-reference';
import {
  DEFAULT_MARKDOWN_WORKBENCH_STATE,
  MARKDOWN_WORKBENCH_ID,
  markdownWorkbenchManifest,
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
  updatedTime: 100,
};

function createBootstrap(
  payload: WorkbenchBootstrap['payload'],
): WorkbenchBootstrap {
  return {
    sessionId: 'session',
    workbenchId: MARKDOWN_WORKBENCH_ID,
    workbenchVersion: markdownWorkbenchManifest.version,
    protocolVersion: markdownWorkbenchManifest.protocolVersion,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };
}

function render(payload: WorkbenchBootstrap['payload']) {
  return renderToStaticMarkup(
    <WorkbenchConversationRuntimeProvider>
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
      </WorkbenchRuntimeProvider>
    </WorkbenchConversationRuntimeProvider>,
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
  it('recognizes a Ctrl-clickable v2 location link in source Markdown only at its href', () => {
    const href = createWorkbenchLocationHref({
      version: 2,
      projectId: 'project',
      assetId: 'source',
      target: {
        scope: 'content', targetType: 'markdown.source-range', targetVersion: 1,
        targetPayload: { exact: 'quoted' },
      },
      sourceRevision: 'r1',
    });
    const line = `[原文](${href})`;

    expect(markdownLocationHrefAt(line, line.indexOf(href))).toBe(href);
    expect(markdownLocationHrefAt(line, 1)).toBeUndefined();
  });

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

  it('exposes retained conflict backups without locking ordinary editing', () => {
    const markup = render({
      ...basePayload,
      conflictBackupsAvailable: true,
    });

    expect(markup).toContain('恢复冲突草稿');
    expect(markup).not.toContain('普通保存已锁定');
  });
});
