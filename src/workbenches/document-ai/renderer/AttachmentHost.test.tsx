// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import {
  WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT,
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

let resolvedRect = { left: 100, top: 120, width: 60, height: 30 };

describe('AttachmentHost', () => {
  let containers: HTMLDivElement[];

  beforeEach(() => {
    containers = [];
    resolvedRect = { left: 100, top: 120, width: 60, height: 30 };
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
      resolve: () => resolvedRect,
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

  it('never animates marker geometry while pages move', () => {
    expect(ATTACHMENT_MARKER_MOTION_CLASS).toBe('transition-colors');
    expect(ATTACHMENT_MARKER_MOTION_CLASS).not.toContain('transition-all');
  });

  it('opens attachment details from the marker and leaves no inline card after closing', async () => {
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
    expect(html).not.toContain('AI 回复内容');
    expect(html).toContain('border-indigo-400/45');

    const marker = container.querySelector<HTMLButtonElement>(
      'button[title="解释这里"]',
    );
    expect(marker).not.toBeNull();
    await act(async () => marker!.click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('附着内容');
    expect(document.body.textContent).toContain('AI 回复内容');
    expect(container.innerHTML).not.toContain('aria-label="收起 AI 回复"');

    const closeDetails = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent === '✕');
    expect(closeDetails).not.toBeNull();
    await act(async () => closeDetails!.click());
    expect(document.body.textContent).not.toContain('附着内容');
    expect(container.innerHTML).not.toContain('AI 回复内容');

    act(() => root.unmount());
  });

  it('updates marker geometry synchronously when the page layout moves', async () => {
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
    });
    const marker = container.querySelector<HTMLButtonElement>(
      'button[title="解释这里"]',
    )!;

    resolvedRect = { left: 42, top: 64, width: 80, height: 44 };
    window.dispatchEvent(
      new Event(WORKBENCH_ANCHOR_LAYOUT_CHANGED_EVENT),
    );

    expect(marker.style.transform).toBe('translate3d(42px, 64px, 0)');
    expect(marker.style.width).toBe('80px');
    expect(marker.style.height).toBe('44px');
    act(() => root.unmount());
  });
});
