import { describe, expect, it } from 'vitest';

import type { ConversationRecord } from '../../../renderer/conversation/conversation-contracts';
import { createContextualConversationTaskRequest } from '../../../renderer/conversation/conversation-task-request';
import {
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';
import { HTML_CONVERSATION_CONTEXT_PROVIDER_ID } from './html-conversation-context';
import {
  createHtmlConversationContribution,
  shouldClearHtmlConversationHighlight,
} from './html-conversation-contribution';

function record(): ConversationRecord {
  return {
    id: 'conversation-1',
    modeId: 'project.general',
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

  it('declares HTML context while the shared conversation layer owns the task', () => {
    const contribution = createHtmlConversationContribution({});
    const context = record().messages[0]!.context!;

    expect(createContextualConversationTaskRequest(contribution, {
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
  });
});
