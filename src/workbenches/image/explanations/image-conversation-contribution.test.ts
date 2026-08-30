import { describe, expect, it, vi } from 'vitest';

import { conversationContextsEqual } from '../../../renderer/conversation/conversation-controller-model';
import { createWorkbenchConversationTaskRequest } from '../../../renderer/conversation/conversation-task-request';
import {
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';
import { createImageRegionTarget } from '../shared';
import {
  createImageConversationContext,
  createImageConversationContribution,
} from './image-conversation-contribution';
import { IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID } from './image-conversation-context';
import { IMAGE_DEFAULT_EXPLANATION_QUESTION } from './shared';

const target = createImageRegionTarget({
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  sourceWidth: 1000,
  sourceHeight: 800,
});

function createContribution(
  revealContext = vi.fn(),
  sourceRevision = 'revision-1',
) {
  return createImageConversationContribution({
    sourceRevision,
    revealContext,
  });
}

describe('image conversation contribution', () => {
  it('declares a validated region while the shared task owns execution', () => {
    const context = createImageConversationContext(target, 'revision-1');
    const request = createWorkbenchConversationTaskRequest(
      createContribution(),
      {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: IMAGE_DEFAULT_EXPLANATION_QUESTION,
        context,
        generateTitle: true,
      },
    );
    expect(request).toMatchObject({
      projectId: 'project-1',
      definitionId: WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
      definitionVersion: WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
      instruction: {
        contextProviderId: IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
        conversationId: 'conversation-1',
        question: IMAGE_DEFAULT_EXPLANATION_QUESTION,
        context,
        commitAnswer: true,
        generateTitle: true,
      },
      assetReferences: { source: [{ assetId: 'asset-1' }] },
    });
  });

  it('continues the stable conversation without another region or Note', () => {
    const request = createWorkbenchConversationTaskRequest(
      createContribution(),
      {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '这个箭头为什么指向右边？',
        generateTitle: false,
      },
    );
    expect(request.instruction).toMatchObject({
      contextProviderId: IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
      conversationId: 'conversation-1',
      question: '这个箭头为什么指向右边？',
    });
    expect(request.instruction).not.toHaveProperty('context');
    expect(request.instruction).not.toHaveProperty('commitAnswer');
    expect(request.assetReferences).toEqual({
      source: [{ assetId: 'asset-1' }],
    });
  });

  it('rejects a missing or stale initial image region', () => {
    expect(() =>
      createWorkbenchConversationTaskRequest(createContribution(), {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '请解释',
        generateTitle: true,
      }),
    ).toThrow('请先在图片中框选一个兴趣区域');

    expect(() =>
      createWorkbenchConversationTaskRequest(createContribution(), {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '请解释',
        context: createImageConversationContext(target, 'revision-2'),
        generateTitle: true,
      }),
    ).toThrow('当前聊天上下文无效');
  });

  it('describes and reveals the exact image region through Image', async () => {
    const revealContext = vi.fn();
    const contribution = createContribution(revealContext);
    const context = createImageConversationContext(target, 'revision-1');
    expect(contribution.describeContext?.(context)).toEqual({
      label: '图片兴趣区域',
      detail: '左侧 10% · 顶部 20% · 30% × 40%',
    });
    await contribution.revealContext?.(context);
    expect(revealContext).toHaveBeenCalledWith(context);
  });

  it('isolates context matching by source revision without owning history', () => {
    const firstContext = createImageConversationContext(target, 'revision-1');
    const secondContext = createImageConversationContext(target, 'revision-2');
    expect(conversationContextsEqual(firstContext, secondContext)).toBe(false);
    expect(createContribution(vi.fn(), 'revision-1').conversationPartitionKey)
      .toBe('revision-1');
    expect(createContribution(vi.fn(), 'revision-2').conversationPartitionKey)
      .toBe('revision-2');

    expect(createContribution()).not.toHaveProperty('historyStore');
  });
});
