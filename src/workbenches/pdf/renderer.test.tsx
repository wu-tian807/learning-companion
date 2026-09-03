import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import { WorkbenchConversationRuntimeProvider } from '../../renderer/conversation/WorkbenchConversationRuntimeProvider';
import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import { mapPdfViewerTarget, PdfWorkbenchView } from './renderer';
import {
  clonePdfWorkbenchState,
  DEFAULT_PDF_WORKBENCH_STATE,
  PDF_PAGE_ANCHOR_TYPE,
  PDF_WORKBENCH_ID,
  pdfWorkbenchManifest,
} from './shared';

const asset: AssetSnapshot = {
  id: 'asset',
  projectId: 'project',
  name: '学习资料',
  mediaType: 'application/pdf',
  creationKind: 'imported',
  contentRef: {
    kind: 'local-file',
    base: 'absolute',
    path: '/tmp/private/learning.pdf',
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
    workbenchId: PDF_WORKBENCH_ID,
    workbenchVersion: pdfWorkbenchManifest.version,
    protocolVersion: pdfWorkbenchManifest.protocolVersion,
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
        <PdfWorkbenchView
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

describe('PdfWorkbenchView', () => {
  it('maps a Workbench Target exactly once before PDF viewer validation', () => {
    const mapTarget = vi.fn(() => ({
      scope: 'content' as const,
      targetType: PDF_PAGE_ANCHOR_TYPE,
      targetVersion: 1,
      targetPayload: { pageNumber: 2 },
    }));
    const input = {
      scope: 'content' as const,
      targetType: 'office.preview.page',
      targetVersion: 1,
      targetPayload: { pageNumber: 2 },
    };

    expect(mapPdfViewerTarget(input, mapTarget)?.targetType).toBe(
      PDF_PAGE_ANCHOR_TYPE,
    );
    expect(mapTarget).toHaveBeenCalledOnce();
    expect(mapTarget).toHaveBeenCalledWith(input);
  });

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
    expect(markup).toContain('user-select: none !important');
    expect(markup).toContain('pointer-events: none');
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
