import { describe, expect, it } from 'vitest';

import { createWorkbenchConversationTaskRequest } from './conversation-task-request';
import {
  createProjectConversationContribution,
  PROJECT_CONVERSATION_OWNER_ID,
} from './project-conversation-contribution';

describe('Project conversation contribution', () => {
  it('creates a Project-scoped chat task without implicitly attaching the selected Asset', () => {
    const contribution = createProjectConversationContribution();
    const request = createWorkbenchConversationTaskRequest(contribution, {
      projectId: 'project-1',
      assetId: 'currently-selected-asset',
      conversationId: 'conversation-1',
      question: '这个 Project 的学习计划怎么安排？',
      generateTitle: true,
    });

    expect(contribution.id).toBe(PROJECT_CONVERSATION_OWNER_ID);
    expect(request.instruction).toMatchObject({
      contextProviderId: 'builtin.project.conversation',
      conversationId: 'conversation-1',
      question: '这个 Project 的学习计划怎么安排？',
      generateTitle: true,
    });
    expect(request.instruction).not.toHaveProperty('assetId');
    expect(request.assetReferences).toEqual({});
  });
});
