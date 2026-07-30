import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { RendererWorkbenchViewProps } from '../../renderer/workbench/renderer-workbench-registry';
import {
  createAbsoluteLocalFileContentRef,
  createAssetContentStatus,
} from '../../shared/assets';
import {
  PDF_PAGE_ANCHOR_TYPE,
} from '../pdf/shared';
import {
  OFFICE_PAGE_ANCHOR_TYPE,
} from './shared';
import {
  mapOfficePreviewInteraction,
  OfficeWorkbenchView,
} from './renderer';

function createProps(): RendererWorkbenchViewProps {
  return {
    asset: {
      id: 'asset',
      projectId: 'project',
      name: '课程',
      mediaType: 'application/msword',
      contentRef: createAbsoluteLocalFileContentRef('/tmp/course.doc'),
      contentStatus: createAssetContentStatus('available', 1),
      createdTime: 1,
      lastUsedTime: 1,
    },
    bootstrap: {
      sessionId: 'session',
      workbenchId: 'builtin.office',
      protocolVersion: 1,
      assetId: 'asset',
      mediaType: 'application/msword',
      availability: 'available',
      payload: {
        status: 'runtime-required',
        viewState: {
          readingMode: 'continuous',
          pageNumber: 1,
          pageOffsetRatio: 0,
          scaleMode: 'page-width',
          customScale: 1,
          rotation: 0,
          sidebar: 'closed',
        },
      },
    },
    executeCommand: vi.fn(),
    onRelink: vi.fn(),
    onRefresh: vi.fn(),
    onReveal: vi.fn(),
    onOpenSettings: vi.fn(),
    onInteractionChange: vi.fn(),
    onOpenExternal: vi.fn(),
    onError: vi.fn(),
  };
}

describe('OfficeWorkbenchView', () => {
  it('explains the local runtime requirement', () => {
    const markup = renderToStaticMarkup(
      <OfficeWorkbenchView {...createProps()} />,
    );

    expect(markup).toContain('需要文档预览组件');
    expect(markup).toContain('原文件不会被修改');
    expect(markup).toContain('打开设置并安装');
  });

  it('maps derived PDF page anchors to Office identity', () => {
    expect(
      mapOfficePreviewInteraction({
        focus: {
          scope: 'content',
          anchorType: PDF_PAGE_ANCHOR_TYPE,
          anchorVersion: 1,
          anchorPayload: { pageNumber: 2 },
        },
        inputs: [],
      }),
    ).toMatchObject({
      focus: {
        anchorType: OFFICE_PAGE_ANCHOR_TYPE,
        anchorPayload: { pageNumber: 2 },
      },
    });
  });
});
