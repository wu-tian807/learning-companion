// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ConversationHistoryStore,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import { ConversationPanelHost } from './ConversationPanelHost';
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

  async function render(runtime: WorkbenchConversationRuntime) {
    await act(async () => {
      root.render(
        <WorkbenchConversationRuntimeProvider runtime={runtime}>
          <ConversationPanelHost
            projectId="project-1"
            historyStore={historyStore}
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

  it('new conversation releases Workbench context and the next send stays Project-owned', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const context = { frame: 1 };
    const onContextReleased = vi.fn();
    const videoContribution: WorkbenchConversationContribution = {
      id: 'video.frame-conversation',
      workbenchId: 'video',
      contextProviderId: 'builtin.video.conversation',
      sourceAssetMode: 'identity',
      contextRequired: true,
      contextRequiredMessage: '请先选择视频画面',
      isContext: (value) =>
        JSON.stringify(value) === JSON.stringify(context),
      onContextReleased,
    };
    runtime.register('video.owner', 'asset-video', videoContribution);
    runtime.open({
      ownerId: 'video.owner',
      context,
    });
    await render(runtime);

    const newConversation = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('新对话'));
    expect(newConversation).toBeDefined();
    await act(async () => {
      newConversation!.click();
      await Promise.resolve();
    });

    expect(runtime.getSnapshot().contextSource).toBeUndefined();
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
