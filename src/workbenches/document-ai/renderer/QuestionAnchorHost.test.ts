import { describe, expect, it } from 'vitest';

import type { AiChatMessage } from './ai-chat/chat-store';
import { groupQuestionAnchors } from './question-anchor-groups';

const target = {
  scope: 'content' as const,
  anchorType: 'pdf.region',
  anchorVersion: 1,
  anchorPayload: { pageNumber: 2, x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
};

describe('groupQuestionAnchors', () => {
  it('keeps only anchored user questions and groups repeated questions at one location', () => {
    const messages: AiChatMessage[] = [
      { id: 'q1', role: 'user', content: '这是什么？', timestamp: 1, anchor: { target } },
      { id: 'a1', role: 'assistant', content: '回答', timestamp: 2 },
      { id: 'q2', role: 'user', content: '再解释一次', timestamp: 3, anchor: { target } },
      { id: 'q3', role: 'user', content: '无选区问题', timestamp: 4 },
    ];

    const groups = groupQuestionAnchors(messages);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.questions.map((message) => message.id)).toEqual(['q1', 'q2']);
  });
});
