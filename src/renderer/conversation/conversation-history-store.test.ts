import { describe, expect, it, vi } from 'vitest';

import type { ConversationRecord } from './conversation-contracts';
import {
  createConversationHistoryKey,
  createLocalConversationHistoryStore,
  type ConversationStorage,
} from './conversation-history-store';

function memoryStorage(initial: Record<string, string> = {}): ConversationStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
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

describe('local Conversation history', () => {
  it('stores complete conversations, updates by stable id and notifies marker views', async () => {
    const storage = memoryStorage();
    const store = createLocalConversationHistoryStore({ key: 'history', storage });
    const listener = vi.fn();
    store.subscribe?.(listener);

    await store.save(record('one'));
    await store.save({ ...record('one', 3), title: '更新后的标题' });

    expect(await store.list()).toHaveLength(1);
    expect((await store.list())[0]).toMatchObject({
      id: 'one',
      title: '更新后的标题',
      updatedTime: 3,
    });
    expect(store.getSnapshot?.()).toEqual(await store.list());
    expect(listener).toHaveBeenCalledTimes(2);

    await store.remove('one');
    expect(await store.list()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('persists the previous answer needed to recover an in-flight re-answer', async () => {
    const storage = memoryStorage();
    const store = createLocalConversationHistoryStore({ key: 'history', storage });
    const inFlight = record('reanswer');
    const assistant = inFlight.messages[1]!;

    await store.save({
      ...inFlight,
      messages: [
        inFlight.messages[0]!,
        {
          ...assistant,
          text: '',
          generationTaskId: 'task-new',
          reanswerBackup: {
            text: '回答',
            generationTaskId: 'task-old',
            modelInfo: 'codex/gpt',
          },
        },
      ],
    });

    const reopened = createLocalConversationHistoryStore({
      key: 'history',
      storage,
    });
    expect((await reopened.list())[0]?.messages[1]).toMatchObject({
      text: '',
      generationTaskId: 'task-new',
      reanswerBackup: {
        text: '回答',
        generationTaskId: 'task-old',
        modelInfo: 'codex/gpt',
      },
    });
  });

  it('migrates the former flat Document AI message history into conversations', async () => {
    const legacyKey = 'legacy';
    const storage = memoryStorage({
      [legacyKey]: JSON.stringify([
        {
          id: 'q1',
          role: 'user',
          content: '解释注意力机制',
          timestamp: 10,
          conversationId: 'conversation-1',
          anchor: { target: { scope: 'asset' } },
        },
        {
          id: 'a1',
          role: 'assistant',
          content: '回答',
          timestamp: 11,
          conversationId: 'conversation-1',
          replyToMessageId: 'q1',
        },
      ]),
    });
    const removeItem = vi.spyOn(storage, 'removeItem');
    const store = createLocalConversationHistoryStore({
      key: 'current',
      storage,
      legacyMessageArrayKeys: [legacyKey],
    });

    expect(await store.list()).toEqual([
      expect.objectContaining({
        id: 'conversation-1',
        title: '解释注意力机制',
        messages: [
          expect.objectContaining({ id: 'q1', role: 'user' }),
          expect.objectContaining({ id: 'a1', replyToMessageId: 'q1' }),
        ],
      }),
    ]);
    expect(removeItem).toHaveBeenCalledWith(legacyKey);
  });

  it('persists an intentional empty history so migrated records cannot reappear', async () => {
    const legacyKey = 'legacy';
    const storage = memoryStorage({
      [legacyKey]: JSON.stringify([
        {
          id: 'q1',
          role: 'user',
          content: '旧问题',
          timestamp: 10,
          conversationId: 'conversation-1',
        },
      ]),
    });
    const options = {
      key: 'current',
      storage,
      legacyMessageArrayKeys: [legacyKey],
    } as const;
    const first = createLocalConversationHistoryStore(options);
    expect(await first.list()).toHaveLength(1);
    await first.remove('conversation-1');

    const reopened = createLocalConversationHistoryStore(options);
    expect(await reopened.list()).toEqual([]);
  });

  it('recovers from corrupt or duplicate persisted records without exposing partial data', async () => {
    const duplicate = record('same');
    const store = createLocalConversationHistoryStore({
      key: 'history',
      storage: memoryStorage({ history: JSON.stringify([duplicate, duplicate]) }),
    });
    expect(await store.list()).toEqual([]);
  });

  it('builds collision-free per-contribution, per-project and per-asset keys', () => {
    expect(createConversationHistoryKey({
      contributionId: 'markdown.question',
      projectId: 'project:a',
      assetId: 'asset/1',
    })).toBe(
      'learning-companion:conversation:v1:markdown.question:project%3Aa:asset%2F1',
    );
  });
});
