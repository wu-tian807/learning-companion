import { describe, expect, it } from 'vitest';

import type { ConversationRecord } from '../../../renderer/conversation/conversation-contracts';
import { createDocumentConversationContext } from './conversation/document-conversation-contribution';
import { groupConversationQuestionAnchors } from './conversation/conversation-question-anchors';

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
});
