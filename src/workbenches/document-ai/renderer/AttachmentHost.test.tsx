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
import { AttachmentHost } from './AttachmentHost';

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

const textAttachment: AssetAttachment = {
  ...attachment,
  id: 'attachment-text',
  target: {
    scope: 'content',
    anchorType: 'text.range',
    anchorVersion: 1,
    anchorPayload: {
      ranges: [{ start: 4, end: 18, exact: '选中问题文本' }],
    },
  },
};

describe('AttachmentHost', () => {
  let containers: HTMLDivElement[];

  beforeEach(() => {
    containers = [];
    window.localStorage.clear();
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

  it('shows a compact marker for text anchors and opens the reply card on click', async () => {
    const container = document.createElement('div');
    containers.push(container);
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AttachmentHost
          attachments={[textAttachment]}
          assetId="asset"
          projectId="project"
          sidebarOpen={false}
          onSidebarOpenChange={() => undefined}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    let html = container.innerHTML;
    expect(html).not.toContain('AI 回复内容');
    const marker = container.querySelector<HTMLButtonElement>(
      'button[aria-label="查看 AI 回复"]',
    );
    expect(marker).not.toBeNull();

    await act(async () => {
      marker?.click();
      await Promise.resolve();
    });
    html = container.innerHTML;
    expect(html).toContain('AI 回复内容');

    act(() => root.unmount());
  });

  it('hides and shows all markers with the visibility toggle', async () => {
    const container = document.createElement('div');
    containers.push(container);
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AttachmentHost
          attachments={[textAttachment]}
          assetId="asset"
          projectId="project"
          sidebarOpen={false}
          onSidebarOpenChange={() => undefined}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    let html = container.innerHTML;
    expect(html).toContain('批注 1');

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="隐藏原文批注标记"]',
        )
        ?.click();
      await Promise.resolve();
    });
    html = container.innerHTML;
    expect(html).toContain('批注已隐藏');
    expect(html).not.toContain('批注 1');

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="显示原文批注标记"]',
        )
        ?.click();
      await Promise.resolve();
    });
    html = container.innerHTML;
    expect(html).toContain('批注 1');

    act(() => root.unmount());
  });
});
