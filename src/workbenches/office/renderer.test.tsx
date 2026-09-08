import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { RendererWorkbenchViewProps } from '../../renderer/workbench/renderer-workbench-registry';
import {
  createAbsoluteLocalFileContentRef,
  createAssetContentStatus,
} from '../../shared/assets';
import {
  PDF_PAGE_ANCHOR_TYPE,
  PDF_REGION_ANCHOR_TYPE,
} from '../pdf/shared';
import {
  OFFICE_PAGE_ANCHOR_TYPE,
  officeWorkbenchManifest,
} from './shared';
import {
  mapOfficePreviewInteraction,
  mapOfficeTargetToPdf,
  OfficeWorkbenchView,
} from './renderer';

function createProps(): RendererWorkbenchViewProps {
  return {
    asset: {
      id: 'asset',
      projectId: 'project',
      name: '课程',
      mediaType: 'application/msword',
      creationKind: 'imported',
      contentRef: createAbsoluteLocalFileContentRef('/tmp/course.doc'),
      contentStatus: createAssetContentStatus('available', 1),
      createdTime: 1,
      updatedTime: 1,
    },
    bootstrap: {
      sessionId: 'session',
      workbenchId: officeWorkbenchManifest.id,
      workbenchVersion: officeWorkbenchManifest.version,
      protocolVersion: officeWorkbenchManifest.protocolVersion,
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
          targetType: PDF_PAGE_ANCHOR_TYPE,
          targetVersion: 1,
          targetPayload: { pageNumber: 2 },
        },
        inputs: [],
      }),
    ).toMatchObject({
      focus: {
        targetType: OFFICE_PAGE_ANCHOR_TYPE,
        targetPayload: { pageNumber: 2 },
      },
    });
  });

  it('keeps legacy PDF preview Targets so existing Office attachments remain visible', () => {
    const legacyTarget = {
      scope: 'content' as const,
      targetType: PDF_REGION_ANCHOR_TYPE,
      targetVersion: 1,
      targetPayload: {
        pageNumber: 5,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.4,
      },
    };

    expect(mapOfficeTargetToPdf(legacyTarget)).toEqual(legacyTarget);
  });
});
