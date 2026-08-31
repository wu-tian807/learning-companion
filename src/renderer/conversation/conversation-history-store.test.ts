import { describe, expect, it, vi } from 'vitest';

import type { LearningCompanionApi } from '../../shared/ipc';
import type { ConversationRecord } from './conversation-contracts';
import { createProjectConversationHistoryStore } from './conversation-history-store';

function record(id: string): ConversationRecord {
  return {
    id,
    title: `对话 ${id}`,
    messages: [
      { id: `${id}-q`, role: 'user', text: '问题', createdTime: 1 },
      { id: `${id}-a`, role: 'assistant', text: '回答', createdTime: 2 },
    ],
    createdTime: 1,
    updatedTime: 2,
  };
}

function createApi(initial: readonly ConversationRecord[] = []) {
  let records = [...initial];
  return {
    listProjectConversations: vi.fn(async () => records),
    saveProjectConversation: vi.fn(async ({ conversation }) => {
      records = [
        ...records.filter((item) => item.id !== conversation.id),
        conversation,
      ];
      return records;
    }),
    deleteProjectConversation: vi.fn(async ({ conversationId }) => {
      records = records.filter((item) => item.id !== conversationId);
      return records;
    }),
  } satisfies Pick<
    LearningCompanionApi,
    | 'listProjectConversations'
    | 'saveProjectConversation'
    | 'deleteProjectConversation'
  >;
}

describe('Project Conversation history', () => {
  it('uses the backend as its only persistence source and publishes mutations', async () => {
    const api = createApi([record('existing')]);
    const store = createProjectConversationHistoryStore({
      projectId: 'project-1',
      api,
    });
    const listener = vi.fn();
    store.subscribe?.(listener);

    await expect(store.list()).resolves.toEqual([record('existing')]);
    await store.save(record('new'));
    await store.remove('existing');

    expect(api.listProjectConversations).toHaveBeenCalledWith({
      projectId: 'project-1',
    });
    expect(api.saveProjectConversation).toHaveBeenCalledWith({
      projectId: 'project-1',
      conversation: record('new'),
    });
    expect(api.deleteProjectConversation).toHaveBeenCalledWith({
      projectId: 'project-1',
      conversationId: 'existing',
    });
    expect(store.getSnapshot?.()).toEqual([record('new')]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('restores history in a new renderer store through the same backend', async () => {
    const api = createApi();
    const first = createProjectConversationHistoryStore({
      projectId: 'project-1',
      api,
    });
    await first.save(record('persisted'));

    const reopened = createProjectConversationHistoryStore({
      projectId: 'project-1',
      api,
    });
    await expect(reopened.list()).resolves.toEqual([record('persisted')]);
    expect(api.listProjectConversations).toHaveBeenCalledTimes(2);
  });
});
