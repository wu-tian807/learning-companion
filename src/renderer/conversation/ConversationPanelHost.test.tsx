// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ConversationHistoryStore,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import {
  ConversationPanelHost,
  ConversationPanelSessionHost,
  ConversationPanelSurface,
} from './ConversationPanelHost';
import { WorkbenchConversationRuntime } from './workbench-conversation-runtime';
import { WorkbenchConversationRuntimeProvider } from './WorkbenchConversationRuntimeProvider';

const historyStore: ConversationHistoryStore = {
  list: async () => [],
  save: async (record) => [record],
  remove: async () => [],
};

describe('ConversationPanelHost Project ownership', () => {
  let container: HTMLDivElement;
  let root: Root;
  let startGenerationTask: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    startGenerationTask = vi.fn(async () => ({ id: 'task-1' }));
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        startGenerationTask,
        getGenerationTask: vi.fn(async () => undefined),
        onGenerationTaskChanged: vi.fn(() => () => undefined),
      },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(
    runtime: WorkbenchConversationRuntime,
    selectedAssetId?: string,
  ) {
    await act(async () => {
      root.render(
        <WorkbenchConversationRuntimeProvider runtime={runtime}>
          <ConversationPanelHost
            projectId="project-1"
            historyStore={historyStore}
            selectedAssetId={selectedAssetId}
            onSelectAsset={vi.fn()}
          />
        </WorkbenchConversationRuntimeProvider>,
      );
      await Promise.resolve();
    });
  }

  async function send(question: string) {
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      setter.call(textarea, question);
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sendButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="发送问题"]',
    );
    expect(sendButton?.disabled).toBe(false);
    await act(async () => {
      sendButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function renderPersistentSurface(
    runtime: WorkbenchConversationRuntime,
    rightRail: boolean,
  ) {
    await act(async () => {
      root.render(
        <WorkbenchConversationRuntimeProvider runtime={runtime}>
          <ConversationPanelSessionHost
            projectId="project-1"
            historyStore={historyStore}
            selectedAssetId="asset-html"
            keepMounted
          >
            {rightRail ? (
              <ConversationPanelSurface onSelectAsset={vi.fn()} />
            ) : (
              <ConversationPanelSurface compact onSelectAsset={vi.fn()} />
            )}
          </ConversationPanelSessionHost>
        </WorkbenchConversationRuntimeProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('rejects unavailable explicit modes without starting a general conversation', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const save = vi.spyOn(historyStore, 'save');
    const pending = runtime.openAndWait({ modeId: 'unavailable.mode', boundAssetId: 'outline-1' });
    const rejected = expect(pending).rejects.toThrow('模式暂不可用');
    await render(runtime);
    await rejected;
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('模式暂不可用');
    expect(container.querySelector('textarea')).toBeNull();
    expect(startGenerationTask).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('sends a new message with no Workbench registered through Project Conversation', async () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.open();
    await render(runtime);

    await send('没有 Workbench 上下文的问题');

    expect(startGenerationTask).toHaveBeenCalledOnce();
    expect(startGenerationTask.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'project-1',
      instruction: {
        contextProviderId: 'builtin.project.conversation',
        question: '没有 Workbench 上下文的问题',
      },
      assetReferences: {},
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('settles an explicit runtime open after the ConversationSession accepts it', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const pending = runtime.openAndWait();

    await render(runtime);
    await expect(pending).resolves.toBeUndefined();
    expect(runtime.getSnapshot().launchRequest).toBeUndefined();
  });

  it('preserves the draft and pending reference when a floating chat expands to the right rail', async () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('html.owner', 'asset-html', {
      contextProviderId: 'builtin.html.conversation',
      sourceAssetMode: 'reference',
    });
    runtime.open({
      ownerId: 'html.owner',
      context: {
        selectedText: '这是需要保留的引用内容。',
        target: {
          scope: 'content',
          targetType: 'html.range',
          targetVersion: 1,
          targetPayload: { path: 'p:1' },
        },
      },
    });
    await renderPersistentSurface(runtime, false);

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      setter.call(textarea, '切换布局后仍应保留的草稿');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('这是需要保留的引用内容。');

    await renderPersistentSurface(runtime, true);

    expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value)
      .toBe('切换布局后仍应保留的草稿');
    expect(container.textContent).toContain('这是需要保留的引用内容。');
    runtime.dispose();
  });

  it('uses the selected Asset Workbench for a contextless Task without rendering a reference card', async () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('html.owner', 'asset-html', {
      contextProviderId: 'builtin.html.conversation',
      sourceAssetMode: 'reference',
    });
    runtime.open();
    await render(runtime, 'asset-html');

    await send('把标题改成课程介绍');

    expect(startGenerationTask).toHaveBeenCalledOnce();
    expect(startGenerationTask.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'project-1',
      instruction: {
        contextProviderId: 'builtin.html.conversation',
        assetId: 'asset-html',
        question: '把标题改成课程介绍',
      },
      assetReferences: {
        source: [{ assetId: 'asset-html' }],
      },
    });
    expect(container.textContent).not.toContain('引用内容');
  });

  it('does not use a stale Workbench registration after the selected Asset changes', async () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('html.owner', 'asset-old', {
      contextProviderId: 'builtin.html.conversation',
      sourceAssetMode: 'reference',
    });
    runtime.open();
    await render(runtime, 'asset-new');

    await send('这是新资料的问题');

    expect(startGenerationTask).toHaveBeenCalledOnce();
    expect(startGenerationTask.mock.calls[0]?.[0]).toMatchObject({
      instruction: {
        contextProviderId: 'builtin.project.conversation',
      },
      assetReferences: {},
    });
  });

  it('new conversation releases Workbench context and the next send stays Project-owned', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const context = { frame: 1 };
    const onContextReleased = vi.fn();
    const videoContribution: WorkbenchConversationContribution = {
      contextProviderId: 'builtin.video.conversation',
      sourceAssetMode: 'identity',
      contextRequired: true,
      contextRequiredMessage: '请先选择视频画面',
      isContext: (value) => JSON.stringify(value) === JSON.stringify(context),
      onContextReleased,
    };
    runtime.register('video.owner', 'asset-video', videoContribution);
    runtime.open({
      ownerId: 'video.owner',
      context,
    });
    await render(runtime);

    const newConversation = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('新对话'),
    );
    expect(newConversation).toBeDefined();
    await act(async () => {
      newConversation!.click();
      await Promise.resolve();
    });

    expect(onContextReleased).toHaveBeenCalledOnce();
    expect(onContextReleased).toHaveBeenCalledWith(context);

    await send('这是新的普通 Project 问题');

    expect(startGenerationTask).toHaveBeenCalledOnce();
    expect(startGenerationTask.mock.calls[0]?.[0]).toMatchObject({
      instruction: {
        contextProviderId: 'builtin.project.conversation',
        question: '这是新的普通 Project 问题',
      },
      assetReferences: {},
    });
  });
});
