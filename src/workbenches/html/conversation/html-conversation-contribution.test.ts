import { describe, expect, it, vi } from 'vitest';

import type { ConversationRecord } from '../../../renderer/conversation/conversation-contracts';
import { createWorkbenchConversationTaskRequest } from '../../../renderer/conversation/conversation-task-request';
import {
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';
import { HTML_CONVERSATION_CONTEXT_PROVIDER_ID } from './html-conversation-context';
import {
  adaptHtmlConversationHistoryStore,
  createHtmlConversationContribution,
  shouldClearHtmlConversationHighlight,
} from './html-conversation-contribution';
import type { HtmlConversationStore } from './conversation-store';

function record(): ConversationRecord {
  return {
    id: 'conversation-1',
    title: 'HTML 问题',
    messages: [
      {
        id: 'q',
        role: 'user',
        text: '解释按钮',
        createdTime: 10,
        context: {
          scope: 'content',
          anchorType: 'html.element',
          anchorVersion: 1,
          anchorPayload: {
            frameUrl: 'learning-content://resource/session',
            tagName: 'button',
            domPath: [1, 2],
            rect: { x: 10, y: 20, width: 80, height: 32 },
            id: 'run',
          },
        },
      },
      {
        id: 'a',
        role: 'assistant',
        text: '这是运行按钮',
        createdTime: 11,
        generationTaskId: 'task-1',
      },
    ],
    createdTime: 10,
    updatedTime: 11,
  };
}

describe('HTML conversation contribution', () => {
  it('does not clear a newly highlighted anchor when releasing an older context', () => {
    const oldAnchor = {
      scope: 'content' as const,
      anchorType: 'html.quote',
      anchorVersion: 1,
      anchorPayload: { exact: 'old selection' },
    };
    const newAnchor = {
      scope: 'content' as const,
      anchorType: 'html.quote',
      anchorVersion: 1,
      anchorPayload: { exact: 'new selection' },
    };

    expect(shouldClearHtmlConversationHighlight(oldAnchor, newAnchor)).toBe(false);
    expect(shouldClearHtmlConversationHighlight(newAnchor, newAnchor)).toBe(true);
    expect(shouldClearHtmlConversationHighlight(undefined, newAnchor)).toBe(true);
  });

  it('keeps the existing file-backed HTML history behind the shared store contract', async () => {
    const entries: Parameters<HtmlConversationStore['save']>[0][] = [];
    const store: HtmlConversationStore = {
      list: vi.fn(async () => entries),
      save: vi.fn(async (entry) => {
        entries.splice(0, entries.length, entry);
        return entries;
      }),
      remove: vi.fn(async () => []),
    };
    const adapted = adaptHtmlConversationHistoryStore(store);
    const sourceRecord = record();

    await adapted.save(sourceRecord);
    const saved = vi.mocked(store.save).mock.calls[0]?.[0];
    expect(saved?.id).toBe('conversation-1');
    expect(saved?.messages[0]).toMatchObject({
      role: 'user',
      anchor: sourceRecord.messages[0]?.context,
    });
    expect(saved?.messages[1]).toMatchObject({
      role: 'assistant',
      generationTaskId: 'task-1',
    });
    const restored = (await adapted.list())[0];
    expect(restored?.id).toBe('conversation-1');
    expect(restored?.messages[0]).toMatchObject({
      role: 'user',
      context: sourceRecord.messages[0]?.context,
    });
    expect(restored?.messages[1]).toMatchObject({
      role: 'assistant',
      generationTaskId: 'task-1',
    });
  });

  it('declares HTML context while the shared conversation layer owns the task', () => {
    const revealContext = vi.fn();
    const historyStore = {
      list: async () => [],
      save: async (saved: ConversationRecord) => [saved],
      remove: async () => [],
    };
    const contribution = createHtmlConversationContribution({
      assetId: 'asset',
      historyStore,
      revealContext,
    });
    const context = record().messages[0]!.context!;

    expect(createWorkbenchConversationTaskRequest(contribution, {
      projectId: 'project',
      assetId: 'asset',
      conversationId: 'conversation-1',
      question: '解释按钮',
      context,
      generateTitle: true,
    })).toMatchObject({
      definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
      definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
      instruction: {
        contextProviderId: HTML_CONVERSATION_CONTEXT_PROVIDER_ID,
        conversationId: 'conversation-1',
        question: '解释按钮',
        context,
      },
      assetReferences: { source: [{ assetId: 'asset' }] },
    });

    contribution.revealContext?.(context);
    expect(revealContext).toHaveBeenCalledWith(context);
  });
});
