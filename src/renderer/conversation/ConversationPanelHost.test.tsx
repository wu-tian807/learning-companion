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

function contribution(): WorkbenchConversationContribution {
  return {
    id: 'html.assistant',
    workbenchId: 'html',
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
      controllerMocks.useConversationController.mock.calls.at(-1)?.[0]
        .initialConversation,
    ).toBeUndefined();

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
  });
});
