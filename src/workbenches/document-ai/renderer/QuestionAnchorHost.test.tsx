// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import type { ConversationRecord } from '../../../renderer/conversation/conversation-contracts';
import { ProjectConversationHistoryProvider } from '../../../renderer/conversation/ProjectConversationHistoryProvider';
import { createDocumentConversationContext } from './conversation/document-conversation-contribution';
import { groupConversationQuestionAnchors } from './conversation/conversation-question-anchors';
import { QuestionAnchorHost } from './QuestionAnchorHost';
import {
  WORKBENCH_RESOLVE_ANCHOR_EVENT,
  type ResolveWorkbenchAnchorDetail,
} from '../../../renderer/workbench/host/workbench-anchor-bridge';
import type { ConversationHistoryStore } from '../../../renderer/conversation/conversation-contracts';
import type { WorkbenchConversationRuntime } from '../../../renderer/conversation/workbench-conversation-runtime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class TestResizeObserver {
  observe() {}
  disconnect() {}
}
globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

const target = {
  scope: 'content' as const,
  anchorType: 'pdf.region',
  anchorVersion: 1,
  anchorPayload: { pageNumber: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
};

describe('groupConversationQuestionAnchors', () => {
  it('keeps only anchored user questions and groups repeated questions at one location', () => {
    const history: readonly ConversationRecord[] = [{
      id: 'conversation',
      title: '问题',
      messages: [
        { id: 'q1', role: 'user', text: '这是什么？', createdTime: 1, context: createDocumentConversationContext({ target }) },
        { id: 'a1', role: 'assistant', text: '回答', createdTime: 2 },
        { id: 'q2', role: 'user', text: '再解释一次', createdTime: 3, context: createDocumentConversationContext({ target }) },
        { id: 'q3', role: 'user', text: '无选区问题', createdTime: 4 },
      ],
      createdTime: 1,
      updatedTime: 4,
    }];

    const groups = groupConversationQuestionAnchors(history);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries.map(({ message }) => message.id)).toEqual(['q1', 'q2']);
  });

  it('rehydrates persisted questions and restores their frames', async () => {
    const records: readonly ConversationRecord[] = [{
      id: 'conversation',
      title: '问题',
      messages: [
        { id: 'q1', role: 'user', text: '这是什么？', createdTime: 1, context: createDocumentConversationContext({ target }) },
      ],
      createdTime: 1,
      updatedTime: 1,
    }];
    const store: ConversationHistoryStore = {
      getSnapshot: () => records,
      subscribe: () => () => undefined,
      list: async () => records,
      save: async () => records,
      remove: async () => records,
    };
    const runtime = { open: () => undefined } as unknown as WorkbenchConversationRuntime;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const resolve = (event: Event) => {
      (event as CustomEvent<ResolveWorkbenchAnchorDetail>).detail.respond({
        left: 10,
        top: 20,
        width: 100,
        height: 40,
      });
    };
    window.addEventListener(WORKBENCH_RESOLVE_ANCHOR_EVENT, resolve);

    try {
      await act(async () => root.render(
        <ProjectConversationHistoryProvider store={store}>
          <QuestionAnchorHost
            assetId="asset"
            ownerId="document.conversation"
            runtime={runtime}
          />
        </ProjectConversationHistoryProvider>,
      ));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(container.querySelector('[data-question-anchor-marker]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      window.removeEventListener(WORKBENCH_RESOLVE_ANCHOR_EVENT, resolve);
      container.remove();
}
  });
});
