import { describe, expect, it, vi } from 'vitest';

import type { GenerationTaskView } from '../../../shared/generation-tasks';
import { createImageRegionTarget } from '../shared';
import {
  createImageConversationContext,
  createImageConversationContribution,
} from './image-conversation-contribution';
import { createImageExplanationTaskDefinitionV1 } from './generation/task-definition';
import { IMAGE_DEFAULT_EXPLANATION_QUESTION } from './shared';

const target = createImageRegionTarget({
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  sourceWidth: 1000,
  sourceHeight: 800,
});

function createContribution(revealContext = vi.fn()) {
  return createImageConversationContribution({
    historyStore: {
      list: async () => [],
      save: async (record) => [record],
      remove: async () => [],
    },
    revealContext,
  });
}

describe('image conversation contribution', () => {
  it('starts with a validated region, vision asset reference, and saved Note', () => {
    const request = createContribution().createTaskRequest({
      projectId: 'project-1',
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: IMAGE_DEFAULT_EXPLANATION_QUESTION,
      context: createImageConversationContext(target),
      generateTitle: true,
    });
    expect(request).toMatchObject({
      projectId: 'project-1',
      definitionId: 'image.explain-region',
      definitionVersion: 1,
      instruction: {
        conversationId: 'conversation-1',
        question: IMAGE_DEFAULT_EXPLANATION_QUESTION,
        target,
        saveAsNote: true,
        generateTitle: true,
      },
      assetReferences: { image: [{ assetId: 'asset-1' }] },
    });
  });

  it('continues the stable conversation without a region or another Note', () => {
    const request = createContribution().createTaskRequest({
      projectId: 'project-1',
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: '这个箭头为什么指向右边？',
      generateTitle: false,
    });
    expect(request.instruction).toMatchObject({
      conversationId: 'conversation-1',
      question: '这个箭头为什么指向右边？',
      saveAsNote: false,
    });
    expect(request.instruction).not.toHaveProperty('target');
    expect(request.assetReferences).toEqual({ image: [{ assetId: 'asset-1' }] });
  });

  it('uses one conversationId from Renderer through TaskDefinition', () => {
    const contribution = createContribution();
    const first = contribution.createTaskRequest({
      projectId: 'project-1', assetId: 'asset-1',
      conversationId: 'conversation-stable',
      question: IMAGE_DEFAULT_EXPLANATION_QUESTION,
      context: createImageConversationContext(target), generateTitle: true,
    });
    const followUp = contribution.createTaskRequest({
      projectId: 'project-1', assetId: 'asset-1',
      conversationId: 'conversation-stable', question: '再详细一点', generateTitle: false,
    });
    const resolve = createImageExplanationTaskDefinitionV1({ process: vi.fn() })
      .primaryWorkspaceConfig.resolveInstanceKey!;
    expect(resolve({ taskId: 'task-1', instruction: first.instruction }))
      .toBe('conversation-stable');
    expect(resolve({ taskId: 'task-2', instruction: followUp.instruction }))
      .toBe('conversation-stable');
  });

  it('rejects starting a new conversation without an image region', () => {
    expect(() => createContribution().createTaskRequest({
      projectId: 'project-1', assetId: 'asset-1',
      conversationId: 'conversation-1', question: '请解释', generateTitle: true,
    })).toThrow('请先在图片中框选一个兴趣区域');
  });

  it('accepts only a complete validated answer and exposes model information', () => {
    const contribution = createContribution();
    const valid = contribution.readTaskResult({
      result: {
        answer: '解释结果', title: '主题',
        providerId: 'codex', modelId: 'gpt-test', attachmentId: 'attachment-1',
      },
    } as unknown as GenerationTaskView);
    const invalid = contribution.readTaskResult({
      result: { answer: '缺少模型信息' },
    } as unknown as GenerationTaskView);
    expect(valid).toEqual({
      answer: '解释结果', title: '主题', modelInfo: 'codex/gpt-test',
    });
    expect(invalid).toBeUndefined();
  });

  it('describes and reveals the exact image region through the Image Workbench', async () => {
    const revealContext = vi.fn();
    const contribution = createContribution(revealContext);
    const context = createImageConversationContext(target);
    expect(contribution.describeContext?.(context)).toEqual({
      label: '图片兴趣区域',
      detail: '左侧 10% · 顶部 20% · 30% × 40%',
    });
    await contribution.revealContext?.(context);
    expect(revealContext).toHaveBeenCalledWith(context);
  });
});
