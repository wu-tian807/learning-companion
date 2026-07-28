import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import { PdfWorkbenchView } from './renderer';
import {
  clonePdfWorkbenchState,
  DEFAULT_PDF_WORKBENCH_STATE,
  PDF_WORKBENCH_ID,
} from './shared';

const asset: AssetSnapshot = {
  id: 'asset',
  projectId: 'project',
  name: '学习资料',
  mediaType: 'application/pdf',
  contentRef: {
    kind: 'local-file',
    path: '/tmp/private/learning.pdf',
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
    workbenchId: PDF_WORKBENCH_ID,
    protocolVersion: 1,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };
}

function render(payload: WorkbenchBootstrap['payload']) {
  return renderToStaticMarkup(
    <PdfWorkbenchView
      asset={asset}
      bootstrap={createBootstrap(payload)}
      headerActionsTarget={null}
      executeCommand={vi.fn(async () => ({
        payload: { saved: true, savedTime: 100 },
      }))}
      onRelink={vi.fn()}
      onRefresh={vi.fn()}
      onReveal={vi.fn()}
      onSelectionChange={vi.fn()}
      onOpenExternal={vi.fn(async () => undefined)}
      onError={vi.fn()}
    />,
  );
}

describe('PdfWorkbenchView', () => {
  it('renders a full-height PDF canvas and local loading state', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/token',
      viewState: clonePdfWorkbenchState(
        DEFAULT_PDF_WORKBENCH_STATE,
      ),
    });

    expect(markup).toContain('aria-label="PDF 阅读工作台"');
    expect(markup).toContain('aria-label="PDF 页面画布"');
    expect(markup).toContain('正在载入 PDF');
    expect(markup).not.toContain('/tmp/private/learning.pdf');
  });

  it('rejects an unsafe bootstrap URL before loading PDF.js', () => {
    const markup = render({
      contentUrl: 'file:///tmp/private/learning.pdf',
      viewState: clonePdfWorkbenchState(
        DEFAULT_PDF_WORKBENCH_STATE,
      ),
    });

    expect(markup).toContain('PDF Workbench 数据无效');
    expect(markup).not.toContain('PDF 页面画布');
  });
});
