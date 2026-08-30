// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ConversationRecord,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import { WorkbenchConversationRuntimeProvider } from './WorkbenchConversationRuntimeProvider';
import { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

const controllerMocks = vi.hoisted(() => ({
  useConversationController: vi.fn(),
}));

vi.mock('./conversation-controller', () => ({
  useConversationController: controllerMocks.useConversationController,
}));

vi.mock('./ConversationPanel', () => ({
  ConversationPanel: () => null,
}));

import { ConversationPanelHost } from './ConversationPanelHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function conversation(id: string): ConversationRecord {
  return {
    id,
    title: id,
    messages: [],
    createdTime: 1,
    updatedTime: 1,
  };
}

function contribution(
  conversationPartitionKey?: string,
): WorkbenchConversationContribution {
  return {
    id: 'html.assistant',
    workbenchId: 'html',
    ...(conversationPartitionKey === undefined
      ? {}
      : { conversationPartitionKey }),
    contextProviderId: 'html.context',
    title: '网页问答',
    emptyLabel: 'empty',
    historyStore: {
      list: async () => [],
      save: async (record) => [record],
      remove: async () => [],
    },
  };
}

describe('ConversationPanelHost', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    controllerMocks.useConversationController.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('restores the current in-memory conversation after a Workbench Session remount', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const activeConversation = conversation('conversation-1');
    const registeredContribution = contribution();
    controllerMocks.useConversationController.mockImplementation(
      (input: { readonly initialConversation?: ConversationRecord }) => ({
        state: {
          tab: 'chat',
          conversation: input.initialConversation ?? activeConversation,
          history: [],
          draft: '',
          busy: false,
          historyLoading: false,
        },
        actions: {
          setTab: vi.fn(),
          setDraft: vi.fn(),
          setPendingContext: vi.fn(),
          submit: vi.fn(),
          cancel: vi.fn(),
          retry: vi.fn(),
          restore: vi.fn(),
          remove: vi.fn(),
          startNew: vi.fn(),
        },
      }),
    );
    const releaseFirst = runtime.register(
      'html:workbench-session-1',
      registeredContribution,
    );

    await act(async () => {
      root.render(
        <WorkbenchConversationRuntimeProvider runtime={runtime}>
          <ConversationPanelHost projectId="project" assetId="asset" />
        </WorkbenchConversationRuntimeProvider>,
      );
      await Promise.resolve();
    });
    expect(
      controllerMocks.useConversationController.mock.calls[0]?.[0]
        .initialConversation,
    ).toBeUndefined();
    expect(
      controllerMocks.useConversationController.mock.calls.at(-1)?.[0]
        .initialConversation,
    ).toBe(activeConversation);

    await act(async () => {
      releaseFirst();
      await Promise.resolve();
    });
    await act(async () => {
      runtime.register(
        'html:workbench-session-2',
        registeredContribution,
      );
      await Promise.resolve();
    });

    expect(
      controllerMocks.useConversationController.mock.calls.at(-1)?.[0]
        .initialConversation,
    ).toBe(activeConversation);

    const lateTaskBinding: ConversationRecord = {
      ...activeConversation,
      messages: [
        {
          id: 'answer',
          role: 'assistant',
          text: '',
          createdTime: 2,
          generationTaskId: 'task-late',
        },
      ],
    };
    await act(async () => {
      runtime.setCurrentConversation(
        {
          projectId: 'project',
          assetId: 'asset',
          contributionId: registeredContribution.id,
        },
        lateTaskBinding,
      );
      await Promise.resolve();
    });
    expect(
      controllerMocks.useConversationController.mock.calls.at(-1)?.[0]
        .initialConversation,
    ).toBe(lateTaskBinding);
  });

  it('starts a separate controller projection when the Workbench partition changes', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const oldConversation = conversation('old-conversation');
    const freshConversation = conversation('fresh-conversation');
    const oldContribution = contribution('revision-1');
    const newContribution = contribution('revision-2');
    controllerMocks.useConversationController.mockImplementation(
      (input: { readonly initialConversation?: ConversationRecord }) => ({
        state: {
          tab: 'chat',
          conversation: input.initialConversation ?? freshConversation,
          history: [],
          draft: '',
          busy: false,
          historyLoading: false,
        },
        actions: {
          setTab: vi.fn(),
          setDraft: vi.fn(),
          setPendingContext: vi.fn(),
          submit: vi.fn(),
          cancel: vi.fn(),
          retry: vi.fn(),
          reanswer: vi.fn(),
          restore: vi.fn(),
          remove: vi.fn(),
          startNew: vi.fn(),
        },
      }),
    );
    runtime.setCurrentConversation(
      {
        projectId: 'project',
        assetId: 'asset',
        contributionId: oldContribution.id,
        conversationPartitionKey: 'revision-1',
      },
      oldConversation,
    );
    runtime.register('image:workbench-session', oldContribution);

    await act(async () => {
      root.render(
        <WorkbenchConversationRuntimeProvider runtime={runtime}>
          <ConversationPanelHost projectId="project" assetId="asset" />
        </WorkbenchConversationRuntimeProvider>,
      );
      await Promise.resolve();
    });
    expect(
      controllerMocks.useConversationController.mock.calls[0]?.[0]
        .initialConversation,
    ).toBe(oldConversation);

    const previousCallCount =
      controllerMocks.useConversationController.mock.calls.length;
    await act(async () => {
      runtime.register('image:workbench-session', newContribution);
      await Promise.resolve();
    });
    expect(
      controllerMocks.useConversationController.mock.calls[previousCallCount]
        ?.[0].initialConversation,
    ).toBeUndefined();
  });
});
