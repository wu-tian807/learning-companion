// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetAttachment } from '../../../shared/attachments/contracts';
import {
  registerWorkbenchTargetController,
  resetWorkbenchTargetControllerForTests,
  WORKBENCH_TARGET_LAYOUT_CHANGED_EVENT,
} from '../../../renderer/workbench/host/workbench-target-bridge';
import { ATTACHMENT_MARKER_MOTION_CLASS, AttachmentHost } from './AttachmentHost';

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

const textAttachment: AssetAttachment = {
  ...attachment,
  id: 'attachment-text',
  target: {
    scope: 'content',
    targetType: 'text.range',
    targetVersion: 1,
    targetPayload: {
      ranges: [{ start: 4, end: 18, exact: '选中问题文本' }],
    },
  },
};

const textAttachment2: AssetAttachment = {
  ...textAttachment,
  id: 'attachment-text-2',
  metadata: { questionPreview: '第二次提问' },
};

describe('AttachmentHost', () => {
  let containers: HTMLDivElement[];

  beforeEach(() => {
    containers = [];
    resolvedRect = { left: 100, top: 120, width: 60, height: 30 };
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
    registerWorkbenchTargetController('test', 'asset', {
      resolve: () => resolvedRect,
      reveal: () => true,
    });
  });

  afterEach(() => {
    resetWorkbenchTargetControllerForTests();
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

  it('keeps a boxed AI reply collapsed until its Target is clicked', async () => {
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
    const marker = container.querySelector<HTMLButtonElement>(
      'button[title="解释这里"]',
    );
    expect(marker).not.toBeNull();

    await act(async () => {
      marker?.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('附着内容');
    expect(document.body.textContent).toContain('AI 回复内容');

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
    expect(marker.className).toContain(ATTACHMENT_MARKER_MOTION_CLASS);
    expect(marker.className).not.toContain('transition-all');

    resolvedRect = { left: 42, top: 64, width: 80, height: 44 };
    window.dispatchEvent(
      new Event(WORKBENCH_TARGET_LAYOUT_CHANGED_EVENT),
    );

    expect(marker.style.transform).toBe('translate3d(42px, 64px, 0)');
    expect(marker.style.width).toBe('80px');
    expect(marker.style.height).toBe('44px');
    act(() => root.unmount());
  });

  it('shows a compact marker for text Targets and opens full details on click', async () => {
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

    const html = container.innerHTML;
    expect(html).not.toContain('AI 回复内容');
    const marker = container.querySelector<HTMLButtonElement>(
      'button[aria-label="查看 AI 回复"]',
    );
    expect(marker).not.toBeNull();

    await act(async () => {
      marker?.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('附着内容');
    expect(document.body.textContent).toContain('AI 回复内容');

    act(() => root.unmount());
  });

  it('does not render a duplicate bottom-right annotation toggle', async () => {
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

    expect(
      container.querySelector(
        'button[aria-label="隐藏原文批注标记"]',
      ),
    ).toBeNull();
    expect(container.innerHTML).not.toContain('批注已隐藏');

    act(() => root.unmount());
  });

  it('opens the latest full attachment directly at one shared Target', async () => {
    const container = document.createElement('div');
    containers.push(container);
    document.body.appendChild(container);
    vi.spyOn(window.learningCompanion, 'readAttachmentContent').mockImplementation(
      async (request: { projectId: string; attachmentId: string }) => ({
        question: '问题',
        answer:
          request.attachmentId === 'attachment-text-2'
            ? '第二次的回复内容'
            : '第一次的回复内容',
      }),
    );
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AttachmentHost
          attachments={[textAttachment, textAttachment2]}
          assetId="asset"
          projectId="project"
          sidebarOpen={false}
          onSidebarOpenChange={() => undefined}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain('第一次的回复内容');
    const marker = container.querySelector<HTMLButtonElement>(
      'button[title*="点击选择"]',
    );
    expect(marker).not.toBeNull();

    await act(async () => {
      marker?.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('附着内容');
    expect(document.body.textContent).toContain('第二次的回复内容');
    expect(document.body.textContent).not.toContain('选择 AI 回复（2）');

    act(() => root.unmount());
  });
});
