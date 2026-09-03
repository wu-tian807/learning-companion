// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createContextualConversationTaskRequest } from '../../../../renderer/conversation/conversation-task-request';
import {
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../../shared/workbench-conversation';
import { DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID } from '../../document-conversation-context';
import {
  createDocumentConversationContext,
  createDocumentConversationContribution,
} from './document-conversation-contribution';

const answerActionPresentation = {
  label: '放回原文旁',
  selectionLabel: '放回选中片段',
  successMessage: '已放回原文旁',
  failureMessage: '无法放回原文旁',
} as const;

describe('Document conversation contribution', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        createAttachment: vi.fn(async () => ({ id: 'attachment' })),
      },
    });
  });

  it('turns a Workbench-owned Target into the shared document TaskDefinition request', () => {
    const contribution = createDocumentConversationContribution({
      projectId: 'project',
      assetId: 'asset',
    });
    const context = createDocumentConversationContext({
      target: {
        scope: 'content',
        targetType: 'markdown.range',
        targetVersion: 1,
        targetPayload: { start: 2, end: 8 },
      },
      selectedText: 'selected',
    });

    expect(createContextualConversationTaskRequest(contribution, {
      projectId: 'project',
      assetId: 'asset',
      conversationId: 'conversation-1',
      question: '解释这里',
      context,
      generateTitle: true,
    })).toMatchObject({
      projectId: 'project',
      definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
      definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
      instruction: {
        contextProviderId: DOCUMENT_CONVERSATION_CONTEXT_PROVIDER_ID,
        conversationId: 'conversation-1',
        question: '解释这里',
        context,
        generateTitle: true,
      },
      assetReferences: { source: [{ assetId: 'asset' }] },
    });
  });

  it('exposes Attachment actions only when the Workbench opts in', async () => {
    const base = {
      projectId: 'project',
      assetId: 'asset',
    } as const;
    expect(
      createDocumentConversationContribution(base).answerAction,
    ).toBeUndefined();

    const contribution = createDocumentConversationContribution({
      ...base,
      allowAnswerAttachments: true,
      answerActionPresentation,
    });
    const question = {
      id: 'q',
      role: 'user' as const,
      text: '问题',
      createdTime: 1,
      context: createDocumentConversationContext({ target: { scope: 'asset' } }),
    };
    const answer = {
      id: 'a',
      role: 'assistant' as const,
      text: '完整回答',
      createdTime: 2,
      replyToMessageId: 'q',
      modelInfo: 'codex/gpt',
    };
    await contribution.answerAction?.execute({
      projectId: 'project',
      assetId: 'asset',
      conversation: {
        id: 'conversation',
        modeId: 'project.general',
        title: '问题',
        messages: [question, answer],
        createdTime: 1,
        updatedTime: 2,
      },
      question,
      answer,
      text: '选中回答',
    });

    expect(window.learningCompanion.createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project',
        assetId: 'asset',
        typeId: 'ai.annotation',
        target: { scope: 'asset' },
        body: expect.objectContaining({ selectedAnswer: '选中回答' }),
      }),
    );
    expect(contribution.answerAction).toMatchObject(answerActionPresentation);
  });

});
