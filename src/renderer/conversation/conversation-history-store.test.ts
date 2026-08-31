import { describe, expect, it, vi } from 'vitest';

import type { LearningCompanionApi } from '../../shared/ipc';
import type { ConversationRecord } from './conversation-contracts';
import { createProjectConversationHistoryStore } from './conversation-history-store';
import {
  collectLegacyProjectConversations,
  type LegacyConversationStorage,
} from './legacy-project-conversation-migration';

function memoryStorage(
  initial: Record<string, string> = {},
): LegacyConversationStorage & { readonly values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function record(id: string, updatedTime = 2): ConversationRecord {
  return {
    id,
    title: `对话 ${id}`,
    messages: [
      { id: `${id}-q`, role: 'user', text: '问题', createdTime: 1 },
      { id: `${id}-a`, role: 'assistant', text: '回答', createdTime: 2 },
    ],
    createdTime: 1,
    updatedTime,
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
    importProjectConversations: vi.fn(async ({ conversations }) => {
      for (const conversation of conversations) {
        const index = records.findIndex((item) => item.id === conversation.id);
        if (index < 0) records.push(conversation);
        else if (conversation.updatedTime >= records[index]!.updatedTime) {
          records[index] = conversation;
        }
      }
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
    | 'importProjectConversations'
    | 'deleteProjectConversation'
  >;
}

describe('Project Conversation history', () => {
  it('uses the backend as the only runtime persistence source', async () => {
    const storage = memoryStorage();
    const api = createApi([record('existing')]);
    const store = createProjectConversationHistoryStore({
      projectId: 'project-1',
      api,
      legacyStorage: storage,
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
    expect(storage.values).toEqual(new Map());
    expect(store.getSnapshot?.()).toEqual([record('new')]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('restores history through a new renderer store using the same backend', async () => {
    const api = createApi();
    const firstStore = createProjectConversationHistoryStore({
      projectId: 'project-1',
      api,
      legacyStorage: memoryStorage(),
    });
    await firstStore.save(record('persisted'));

    const reopenedStore = createProjectConversationHistoryStore({
      projectId: 'project-1',
      api,
      legacyStorage: memoryStorage(),
    });

    await expect(reopenedStore.list()).resolves.toEqual([
      record('persisted'),
    ]);
    expect(api.listProjectConversations).toHaveBeenCalledTimes(2);
  });

  it('imports all valid Project legacy keys once and removes them after success', async () => {
    const currentKey =
      'learning-companion:conversation:v1:video.frame-conversation:project-1:asset-1';
    const documentKey =
      'learning-companion:document-ai-history:v1:project-1:asset-2';
    const unrelatedKey =
      'learning-companion:conversation:v1:image.conversation:project-2:asset-3';
    const storage = memoryStorage({
      [currentKey]: JSON.stringify([record('current', 4)]),
      [documentKey]: JSON.stringify([
        {
          id: 'legacy-q',
          role: 'user',
          content: '解释注意力机制',
          timestamp: 10,
          conversationId: 'legacy-conversation',
          anchor: { target: { scope: 'asset' } },
        },
        {
          id: 'legacy-a',
          role: 'assistant',
          content: '回答',
          timestamp: 11,
          conversationId: 'legacy-conversation',
          replyToMessageId: 'legacy-q',
        },
      ]),
      [unrelatedKey]: JSON.stringify([record('unrelated')]),
    });
    const api = createApi();
    const store = createProjectConversationHistoryStore({
      projectId: 'project-1',
      api,
      legacyStorage: storage,
    });

    const records = await store.list();

    expect(records.map(({ id }) => id)).toEqual([
      'current',
      'legacy-conversation',
    ]);
    expect(api.importProjectConversations).toHaveBeenCalledOnce();
    expect(api.listProjectConversations).not.toHaveBeenCalled();
    expect(storage.getItem(currentKey)).toBeNull();
    expect(storage.getItem(documentKey)).toBeNull();
    expect(storage.getItem(unrelatedKey)).not.toBeNull();
  });

  it('keeps legacy data when backend import fails so migration is retryable', async () => {
    const key =
      'learning-companion:conversation:v1:video.frame-conversation:project-1:asset-1';
    const storage = memoryStorage({ [key]: JSON.stringify([record('old')]) });
    const api = createApi();
    api.importProjectConversations.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    const store = createProjectConversationHistoryStore({
      projectId: 'project-1',
      api,
      legacyStorage: storage,
    });

    await expect(store.list()).rejects.toThrow('database unavailable');
    expect(storage.getItem(key)).not.toBeNull();
  });

  it('retires a valid empty legacy key after the backend list succeeds', async () => {
    const key =
      'learning-companion:conversation:v1:epub.reading-conversation:project-1:asset-1';
    const storage = memoryStorage({ [key]: '[]' });
    const api = createApi();

    await createProjectConversationHistoryStore({
      projectId: 'project-1',
      api,
      legacyStorage: storage,
    }).list();

    expect(api.listProjectConversations).toHaveBeenCalledOnce();
    expect(storage.getItem(key)).toBeNull();
  });

  it('ignores corrupt keys and keeps the newest duplicate conversation', () => {
    const storage = memoryStorage({
      'learning-companion:conversation:v1:video.frame-conversation:project-1:asset-1':
        JSON.stringify([record('same', 2)]),
      'learning-companion:conversation:v1:image.conversation:project-1:asset-2':
        JSON.stringify([record('same', 5)]),
      'learning-companion:conversation:v1:broken:project-1:asset-3': '{',
    });

    const migration = collectLegacyProjectConversations(
      'project-1',
      storage,
    );

    expect(migration.records).toEqual([record('same', 5)]);
    expect(migration.keys).toHaveLength(2);
  });
});
