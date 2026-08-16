import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkbenchRuntimeProvider } from '../../renderer/workbench/runtime/WorkbenchRuntimeProvider';
import { WorkbenchConversationRuntimeProvider } from '../../renderer/conversation/WorkbenchConversationRuntimeProvider';
import type { AssetSnapshot } from '../../shared/assets';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import { interactionFromTextSelection } from '../../shared/workbench/selection';
import {
  HTML_DOCUMENT_SANDBOX,
  HtmlDocumentFrame,
  HtmlWorkbenchView,
  pendingHtmlTextSelection,
} from './renderer';
import {
  HTML_WORKBENCH_ID,
  createHtmlQuoteTarget,
  htmlWorkbenchManifest,
} from './shared';

const asset: AssetSnapshot = {
  id: 'asset',
  projectId: 'project',
  name: '课程页面',
  mediaType: 'text/html',
  creationKind: 'imported',
  contentRef: {
    kind: 'local-file',
    base: 'absolute',
    path: '/private/lesson.html',
  },
  contentStatus: { availability: 'available', checkedTime: 100 },
  createdTime: 100,
  updatedTime: 100,
};

function render(payload: WorkbenchBootstrap['payload']) {
  const bootstrap: WorkbenchBootstrap = {
    sessionId: 'session',
    workbenchId: HTML_WORKBENCH_ID,
    workbenchVersion: htmlWorkbenchManifest.version,
    protocolVersion: htmlWorkbenchManifest.protocolVersion,
    assetId: asset.id,
    mediaType: asset.mediaType,
    availability: 'available',
    payload,
  };

  return renderToStaticMarkup(
    <WorkbenchConversationRuntimeProvider>
      <WorkbenchRuntimeProvider onError={vi.fn()}>
        <HtmlWorkbenchView
          asset={asset}
          bootstrap={bootstrap}
          executeCommand={vi.fn()}
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

describe('HtmlWorkbenchView', () => {
  it('runs original HTML in a script-capable isolated frame', () => {
    const markup = renderToStaticMarkup(
      <HtmlDocumentFrame
        contentUrl="learning-content://resource/html"
        title="交互讲义"
      />,
    );

    expect(markup).toContain(
      'src="learning-content://resource/html"',
    );
    expect(markup).toContain('aria-label="HTML 原文沙箱"');
    expect(HTML_DOCUMENT_SANDBOX).toContain('allow-scripts');
    expect(HTML_DOCUMENT_SANDBOX).toContain('allow-pointer-lock');
    expect(HTML_DOCUMENT_SANDBOX).not.toContain('allow-same-origin');
    expect(HTML_DOCUMENT_SANDBOX).not.toContain('allow-top-navigation');
  });

  it('renders only the original document without a reader-mode shell', () => {
    const markup = render({
      contentUrl: 'learning-content://resource/html',
    });

    expect(markup).toContain('HTML 原文沙箱');
    expect(markup).toContain('正在加载 HTML 原文及外部资源');
    expect(markup).not.toContain('阅读模式');
    expect(markup).not.toContain('原文模式');
    expect(markup).not.toContain('/private/lesson.html');
  });

  it('rejects non-scoped content URLs', () => {
    const markup = render({
      contentUrl: 'file:///private/lesson.html',
    });

    expect(markup).toContain('HTML Workbench 数据无效');
  });

  it('keeps the captured DOM Range when the text selection is consumed', () => {
    const target = createHtmlQuoteTarget(
      '表格里的重复文字',
      'learning-content://resource/html',
      { x: 20, y: 40, width: 120, height: 36 },
      {
        domRange: {
          start: { path: [1, 2, 0], offset: 0 },
          end: { path: [1, 2, 2], offset: 6 },
        },
      },
    );
    const pending = pendingHtmlTextSelection(
      interactionFromTextSelection({
        text: '表格里的重复文字',
        target,
      }),
    );

    expect(pending?.target).toBe(target);
    expect(pending?.target.anchorPayload).toMatchObject({
      domRange: {
        start: { path: [1, 2, 0], offset: 0 },
        end: { path: [1, 2, 2], offset: 6 },
      },
    });
    expect(pending?.rect).toEqual({
      x: 20,
      y: 40,
      width: 120,
      height: 36,
    });
  });
});
