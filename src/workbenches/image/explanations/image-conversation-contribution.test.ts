import { describe, expect, it } from 'vitest';

import { conversationContextsEqual } from '../../../renderer/conversation/conversation-controller-model';
import { createContextualConversationTaskRequest } from '../../../renderer/conversation/conversation-task-request';
import {
  WORKBENCH_CONVERSATION_TASK_DEFINITION_ID,
  WORKBENCH_CONVERSATION_TASK_DEFINITION_VERSION,
} from '../../../shared/workbench-conversation';
import { createImageRegionTarget } from '../shared';
import {
  createImageConversationContext,
  createImageConversationContribution,
} from './image-conversation-contribution';
import {
  IMAGE_CONVERSATION_CONTEXT_PROVIDER_ID,
  parseImageConversationContext,
} from './image-conversation-context';
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
  sourceRevision = 'revision-1',
) {
  return createImageConversationContribution({
    sourceRevision,
  });
}

describe('image conversation contribution', () => {
  it('declares a validated region while the shared task owns execution', () => {
    const context = createImageConversationContext(target, 'revision-1');
    const request = createContextualConversationTaskRequest(
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

  it('does not expose a context-free follow-up path through Image', () => {
    expect(() =>
      createContextualConversationTaskRequest(createContribution(), {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '这个箭头为什么指向右边？',
        generateTitle: false,
      }),
    ).toThrow('请先在图片中框选一个兴趣区域');
  });

  it('rejects a missing or stale initial image region', () => {
    expect(() =>
      createContextualConversationTaskRequest(createContribution(), {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '请解释',
        generateTitle: true,
      }),
    ).toThrow('请先在图片中框选一个兴趣区域');

    expect(() =>
      createContextualConversationTaskRequest(createContribution(), {
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '请解释',
        context: createImageConversationContext(target, 'revision-2'),
        generateTitle: true,
      }),
    ).toThrow('当前聊天上下文无效');
  });
  it('isolates context matching by source revision without owning history', () => {
    const firstContext = createImageConversationContext(target, 'revision-1');
    const secondContext = createImageConversationContext(target, 'revision-2');
    expect(conversationContextsEqual(firstContext, secondContext)).toBe(false);

    expect(createContribution()).not.toHaveProperty('historyStore');
  });

  it('rejects persisted pre-Target image context', () => {
    const legacy = {
      sourceRevision: 'revision-1',
      target: {
        scope: 'content',
        anchorType: target.targetType,
        anchorVersion: target.targetVersion,
        anchorPayload: target.targetPayload,
      },
    };

    expect(parseImageConversationContext(legacy)).toBeUndefined();
    expect(createContribution().isContext?.(legacy)).toBe(false);
  });
});
