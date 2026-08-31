// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LearningCompanionApi } from '../../../shared/ipc';

import {
  registerWorkbenchAnchorController,
  resetWorkbenchAnchorControllerForTests,
} from '../../../renderer/workbench/host/workbench-anchor-bridge';
import { WorkbenchConversationRuntimeProvider } from '../../../renderer/conversation/WorkbenchConversationRuntimeProvider';
import { ConversationHistoryStoreProvider } from '../../../renderer/conversation/conversation-history-context';
import { createProjectConversationHistoryStore } from '../../../renderer/conversation/conversation-history-store';
import { QuestionAnchorHost } from './QuestionAnchorHost';

const conversation = {
  id: 'question-1',
  title: '解释这个公式',
  messages: [
    {
      id: 'question-message',
      role: 'user' as const,
      text: '这个公式是什么意思？',
      createdTime: 1,
      context: {
        target: {
          scope: 'content' as const,
          anchorType: 'pdf.region',
          anchorVersion: 1,
          anchorPayload: { pageNumber: 3, x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
        },
      },
      contextSource: {
        contextProviderId: 'document-ai.context',
        assetId: 'asset-question-anchor',
      },
    },
  ],
  createdTime: 1,
  updatedTime: 1,
};

describe('QuestionAnchorHost', () => {
  let container: HTMLDivElement;
  const listProjectConversations = vi.fn(async () => [conversation]);
  const deleteProjectConversation = vi.fn(async () => []);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    (window as { learningCompanion?: unknown }).learningCompanion = {
      listProjectConversations,
      deleteProjectConversation,
      saveProjectConversation: vi.fn(),
    };
    vi.stubGlobal('confirm', vi.fn(() => true));
    registerWorkbenchAnchorController('question-test', 'asset-question-anchor', {
      resolve: () => ({ left: 16, top: 24, width: 120, height: 36 }),
      reveal: vi.fn(() => true),
    });
  });

  afterEach(() => {
    resetWorkbenchAnchorControllerForTests();
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('opens a marker menu and deletes the anchored question group', async () => {
    const root = createRoot(container);
    const api = {
      listProjectConversations,
      deleteProjectConversation,
      saveProjectConversation: vi.fn(async () => []),
    } satisfies Pick<
      LearningCompanionApi,
      | 'listProjectConversations'
      | 'deleteProjectConversation'
      | 'saveProjectConversation'
    >;
    const historyStore = createProjectConversationHistoryStore({
      projectId: 'marker-project',
      api,
    });
    await act(async () => {
      root.render(
        <WorkbenchConversationRuntimeProvider>
          <ConversationHistoryStoreProvider store={historyStore}>
            <QuestionAnchorHost assetId="asset-question-anchor" />
          </ConversationHistoryStoreProvider>
        </WorkbenchConversationRuntimeProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const marker = container.querySelector<HTMLButtonElement>('[data-question-anchor-marker]');
    expect(marker).not.toBeNull();
    await act(async () => marker?.click());
    expect(container.textContent).toContain('删除提问');

    const remove = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '删除提问',
    );
    await act(async () => {
      remove?.click();
      await Promise.resolve();
    });

    expect(deleteProjectConversation).toHaveBeenCalledWith({
      projectId: 'marker-project',
      conversationId: 'question-1',
    });
    expect(container.querySelector('[data-question-anchor-marker]')).toBeNull();
    act(() => root.unmount());
  });
});
