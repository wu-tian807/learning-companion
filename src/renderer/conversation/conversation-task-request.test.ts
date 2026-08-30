import { describe, expect, it } from 'vitest';

import {
  createContextualConversationTaskRequest,
  createConversationTaskRequest,
} from './conversation-task-request';

describe('Conversation task request ownership', () => {
  it('uses Project Conversation for every message without an attached context source', () => {
    const request = createConversationTaskRequest({
      projectId: 'project-1',
      assetId: 'currently-selected-asset',
      conversationId: 'conversation-1',
      question: '普通问题',
      generateTitle: true,
    });

    expect(request.instruction).toMatchObject({
      contextProviderId: 'builtin.project.conversation',
      conversationId: 'conversation-1',
      question: '普通问题',
      generateTitle: true,
    });
    expect(request.instruction).not.toHaveProperty('assetId');
    expect(request.assetReferences).toEqual({});
  });

  it('uses Workbench semantics only when that turn has an explicit context source', () => {
    const request = createContextualConversationTaskRequest(
      {
        id: 'pdf.question',
        workbenchId: 'pdf',
        contextProviderId: 'document.context',
        sourceAssetMode: 'reference',
        isContext: (context) =>
          JSON.stringify(context) === JSON.stringify({ page: 2 }),
      },
      {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '解释第二页',
        context: { page: 2 },
        generateTitle: false,
      },
    );

    expect(request.instruction).toMatchObject({
      contextProviderId: 'document.context',
      assetId: 'asset-1',
      context: { page: 2 },
    });
    expect(request.assetReferences).toEqual({
      source: [{ assetId: 'asset-1' }],
    });
  });

  it('rejects opaque context that has no Workbench-provided source', () => {
    expect(() =>
      createConversationTaskRequest({
        projectId: 'project-1',
        conversationId: 'conversation-1',
        question: '来源不明',
        context: { page: 2 },
        generateTitle: false,
      }),
    ).toThrow('当前聊天上下文缺少来源');
  });
});
