import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import { WorkbenchConversationRuntimeProvider } from '../../renderer/conversation/WorkbenchConversationRuntimeProvider';
import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import { EpubWorkbenchView } from './renderer';
import {
  cloneEpubViewState,
  DEFAULT_EPUB_VIEW_STATE,
  EPUB_WORKBENCH_ID,
  epubWorkbenchManifest,
} from './shared';

const asset: AssetSnapshot = {
  id: 'asset',
  projectId: 'project',
  name: '电子书',
  mediaType: 'application/epub+zip',
  creationKind: 'imported',
  contentRef: {
    kind: 'local-file',
    base: 'absolute',
    path: '/private/book.epub',
  },
  contentStatus: { availability: 'available', checkedTime: 100 },
  createdTime: 100,
  updatedTime: 100,
};

function render(payload: WorkbenchBootstrap['payload']) {
  const bootstrap: WorkbenchBootstrap = {
    sessionId: 'session',
    workbenchId: EPUB_WORKBENCH_ID,
    workbenchVersion: epubWorkbenchManifest.version,
    protocolVersion: epubWorkbenchManifest.protocolVersion,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };

  return renderToStaticMarkup(
    <WorkbenchConversationRuntimeProvider>
      <WorkbenchRuntimeProvider onError={vi.fn()}>
        <EpubWorkbenchView
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
      </WorkbenchRuntimeProvider>
    </WorkbenchConversationRuntimeProvider>,
  );
}

describe('EpubWorkbenchView', () => {
  it('renders a stable reader host without exposing its file path', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/epub',
      viewState: cloneEpubViewState(DEFAULT_EPUB_VIEW_STATE),
    });

    expect(markup).toContain('aria-label="EPUB 阅读区域"');
    expect(markup).toContain('aria-label="切换 EPUB 标注索引（0）"');
    expect(markup).toContain('正在解析 EPUB');
    expect(markup).not.toContain('/private/book.epub');
  });

  it('rejects an unsafe bootstrap URL', () => {
    const markup = render({
      contentUrl: 'file:///private/book.epub',
      viewState: cloneEpubViewState(DEFAULT_EPUB_VIEW_STATE),
    });

    expect(markup).toContain('EPUB Workbench 数据无效');
  });
});
