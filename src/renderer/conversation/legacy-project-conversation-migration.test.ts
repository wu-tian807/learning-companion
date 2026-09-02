import { describe, expect, it, vi } from 'vitest';

import type { ConversationRecord } from '../../shared/project-conversations';
import {
  collectLegacyProjectConversations,
  migrateLegacyProjectConversations,
  type LegacyConversationStorage,
} from './legacy-project-conversation-migration';

function storage(values: Record<string, string>): LegacyConversationStorage {
  const entries = new Map(Object.entries(values));
  return {
    get length() { return entries.size; },
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => { entries.delete(key); },
  };
}

describe('legacy Project conversation migration', () => {
  it('recovers asset chat messages and preserves their selected context', () => {
    const legacy = storage({
      'learning-companion:document-ai-history:v1:project-1:asset-1': JSON.stringify([
        {
          id: 'question-1',
          role: 'user',
          content: '解释这里',
          timestamp: 10,
          anchor: {
            target: { scope: 'content', anchorType: 'office.region', anchorVersion: 1, anchorPayload: { pageNumber: 2 } },
            pageNumber: 2,
          },
        },
        {
          id: 'answer-1',
          role: 'assistant',
          content: '旧回答',
          timestamp: 11,
          replyToMessageId: 'question-1',
        },
      ]),
    });

    const result = collectLegacyProjectConversations('project-1', legacy);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      modeId: 'project.general',
      title: '解释这里',
      messages: [
        expect.objectContaining({
          role: 'user',
          contextSource: expect.objectContaining({
            contextProviderId: 'document-ai.context',
            assetId: 'asset-1',
          }),
        }),
        expect.objectContaining({ role: 'assistant', text: '旧回答' }),
      ],
    });
  });

  it('removes old storage only after every recovered record is saved', async () => {
    const key = 'learning-companion:document-ai-history:v1:project-1:asset-1';
    const legacy = storage({
      [key]: JSON.stringify([{ id: 'q', role: 'user', content: '问题', timestamp: 1 }]),
    });
    const remove = vi.spyOn(legacy, 'removeItem');
    let records: ConversationRecord[] = [];
    const api = {
      listProjectConversations: vi.fn(async () => records),
      saveProjectConversation: vi.fn(async ({ conversation }: { conversation: ConversationRecord }) => {
        records = [conversation];
        return records;
      }),
    };

    await migrateLegacyProjectConversations({ projectId: 'project-1', api, storage: legacy });

    expect(api.saveProjectConversation).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(key);
  });

  it('keeps old storage intact when persistence fails', async () => {
    const key = 'learning-companion:document-ai-history:v1:project-1:asset-1';
    const legacy = storage({
      [key]: JSON.stringify([{ id: 'q', role: 'user', content: '问题', timestamp: 1 }]),
    });
    const remove = vi.spyOn(legacy, 'removeItem');
    await expect(migrateLegacyProjectConversations({
      projectId: 'project-1',
      api: {
        listProjectConversations: vi.fn(async () => []),
        saveProjectConversation: vi.fn(async () => { throw new Error('disk full'); }),
      },
      storage: legacy,
    })).rejects.toThrow('disk full');
    expect(remove).not.toHaveBeenCalled();
    expect(legacy.getItem(key)).not.toBeNull();
  });
});
