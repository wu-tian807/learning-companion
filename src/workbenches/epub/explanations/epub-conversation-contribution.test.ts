import { describe, expect, it, vi } from 'vitest';

import { createContextualConversationTaskRequest } from '../../../renderer/conversation/conversation-task-request';
import {
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';
import { createEpubCfiRangeTarget } from '../shared';
import {
  createEpubConversationContext,
  createEpubConversationContribution,
} from './epub-conversation-contribution';
import { EPUB_CONVERSATION_CONTEXT_PROVIDER_ID } from './epub-conversation-context';
import { EPUB_DEFAULT_EXPLANATION_QUESTION } from './shared';

const target = createEpubCfiRangeTarget({
  cfiRange: 'epubcfi(/6/4!/4/2/1:0,/1:8)',
  quote: {
    exact: '需要持续追问的文字',
    prefix: '前文',
    suffix: '后文',
  },
});

function createContribution() {
  return createEpubConversationContribution({
    revealContext: vi.fn(),
  });
}

describe('EPUB conversation contribution', () => {
  it('declares CFI context while the shared task owns execution and Note commit', () => {
    const context = createEpubConversationContext(target);
    const request = createContextualConversationTaskRequest(
      createContribution(),
      {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: EPUB_DEFAULT_EXPLANATION_QUESTION,
        context,
        generateTitle: true,
      },
    );

    expect(request).toMatchObject({
      projectId: 'project-1',
      definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
      definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
      instruction: {
        contextProviderId: EPUB_CONVERSATION_CONTEXT_PROVIDER_ID,
        conversationId: 'conversation-1',
        question: EPUB_DEFAULT_EXPLANATION_QUESTION,
        context,
        commitAnswer: true,
        generateTitle: true,
      },
      assetReferences: {},
    });
  });

  it('does not expose a context-free follow-up path through EPUB', () => {
    expect(() =>
      createContextualConversationTaskRequest(createContribution(), {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '这里的“它”指什么？',
        generateTitle: false,
      }),
    ).toThrow('请先在 EPUB 中选中一段文字');
  });

  it('starts a selected-text custom question without creating an AI explanation Note', () => {
    const context = createEpubConversationContext(target);
    const request = createContextualConversationTaskRequest(
      createContribution(),
      {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-custom',
        question: '这句话为什么使用反问？',
        context,
        generateTitle: true,
      },
    );

    expect(request.instruction).toMatchObject({
      question: '这句话为什么使用反问？',
      context,
    });
    expect(request.instruction).not.toHaveProperty('commitAnswer');
  });

  it('rejects starting a new conversation without an EPUB selection', () => {
    expect(() =>
      createContextualConversationTaskRequest(createContribution(), {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '请解释',
        generateTitle: true,
      }),
    ).toThrow('请先在 EPUB 中选中一段文字');
  });

  it('presents the selected quote and delegates reveal to EPUB', async () => {
    const revealContext = vi.fn();
    const contribution = createEpubConversationContribution({
      revealContext,
    });
    const context = createEpubConversationContext(target);

    expect(contribution.describeContext?.(context)).toEqual({
      label: 'EPUB 选区',
      detail: '需要持续追问的文字',
    });
    await contribution.revealContext?.(context);
    expect(revealContext).toHaveBeenCalledWith(context);
  });
});
