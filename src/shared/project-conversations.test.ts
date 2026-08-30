import { describe, expect, it } from 'vitest';

import {
  cloneConversationRecord,
  isConversationMessageRecord,
} from './project-conversations';

describe('Project Conversation context source records', () => {
  it('persists the source of an explicitly attached Workbench context', () => {
    const record = cloneConversationRecord({
      id: 'conversation-1',
      title: '上下文问答',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          text: '解释这段内容',
          createdTime: 1,
          context: { page: 2 },
          contextSource: {
            contextProviderId: 'document.context',
            assetId: 'asset-1',
            sourceAssetMode: 'reference',
            commitAnswer: true,
          },
        },
      ],
      createdTime: 1,
      updatedTime: 1,
    });

    expect(record.messages[0]?.contextSource).toEqual({
      contextProviderId: 'document.context',
      assetId: 'asset-1',
      sourceAssetMode: 'reference',
      commitAnswer: true,
    });
    expect(Object.isFrozen(record.messages[0]?.contextSource)).toBe(true);
  });

  it('rejects malformed or assistant-owned context sources', () => {
    const base = {
      id: 'message-1',
      role: 'user' as const,
      text: '问题',
      createdTime: 1,
    };
    expect(isConversationMessageRecord({
      ...base,
      contextSource: {
        contextProviderId: 'document.context',
        sourceAssetMode: 'reference',
      },
    })).toBe(false);
    expect(isConversationMessageRecord({
      ...base,
      role: 'assistant',
      contextSource: {
        contextProviderId: 'document.context',
      },
    })).toBe(false);
  });
});
