// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import {
  registerWorkbenchAnchorController,
  resetWorkbenchAnchorControllerForTests,
} from '../../../renderer/workbench/host/workbench-anchor-bridge';
import {
  ATTACHMENT_MARKER_MOTION_CLASS,
  AttachmentHost,
} from './AttachmentHost';

const attachment: AssetAttachment = {
  id: 'attachment-1',
  projectId: 'project',
  assetId: 'asset',
  typeId: 'ai.annotation',
  typeVersion: 1,
  target: { scope: 'asset' },
  metadata: { questionPreview: '解释这里' },
  createdTime: 1,
  updatedTime: 1,
};

describe('AttachmentHost', () => {
  let containers: HTMLDivElement[];

  beforeEach(() => {
    containers = [];
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    (window as { learningCompanion?: unknown }).learningCompanion = {
      readAttachmentContent: vi.fn(async () => ({
        question: '解释这段内容',
        answer: 'AI 回复内容',
      })),
    };
    registerWorkbenchAnchorController('test', 'asset', {
      resolve: () => ({ left: 100, top: 120, width: 60, height: 30 }),
      reveal: () => true,
    });
  });

  afterEach(() => {
    resetWorkbenchAnchorControllerForTests();
    for (const container of containers) {
      container.remove();
    }
  });

  it('does not animate marker coordinates while the document scrolls', () => {
    expect(ATTACHMENT_MARKER_MOTION_CLASS).toBe('transition-colors');
    expect(ATTACHMENT_MARKER_MOTION_CLASS).not.toContain('transition-all');
  });

  it('renders the annotation sidebar only when the header action opens it', () => {
    const html = renderToStaticMarkup(
      <AttachmentHost
        attachments={[attachment]}
        assetId="asset"
        projectId="project"
        sidebarOpen={false}
        onSidebarOpenChange={() => undefined}
      />,
    );

    expect(html).not.toContain('标注 1');
    expect(html).not.toContain('文档标注');
  });

  it('renders the boxed AI reply card at the original anchor position', async () => {
    const container = document.createElement('div');
    containers.push(container);
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AttachmentHost
          attachments={[attachment]}
          assetId="asset"
          projectId="project"
          sidebarOpen={false}
          onSidebarOpenChange={() => undefined}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const html = container.innerHTML;
    expect(html).toContain('AI 回复');
    expect(html).toContain('AI 回复内容');
    expect(html).toContain('border-indigo-400/45');

    act(() => root.unmount());
  });
});
