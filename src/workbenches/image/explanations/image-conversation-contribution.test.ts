import { describe, expect, it, vi } from 'vitest';

import type { GenerationTaskView } from '../../../shared/generation-tasks';
import { conversationContextsEqual } from '../../../renderer/conversation/conversation-controller-model';
import { createImageRegionTarget } from '../shared';
import {
  createImageConversationContext,
  createImageConversationContribution,
  createImageConversationHistoryStore,
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

function createContribution(
  revealContext = vi.fn(),
  sourceRevision = 'revision-1',
) {
  return createImageConversationContribution({
    sourceRevision,
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
      context: createImageConversationContext(target, 'revision-1'),
      generateTitle: true,
    });
    expect(request).toMatchObject({
      projectId: 'project-1',
      definitionId: 'image.explain-region',
      definitionVersion: 1,
      instruction: {
        conversationId: 'conversation-1',
        sourceRevision: 'revision-1',
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
      sourceRevision: 'revision-1',
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
      context: createImageConversationContext(target, 'revision-1'), generateTitle: true,
    });
    const followUp = contribution.createTaskRequest({
      projectId: 'project-1', assetId: 'asset-1',
      conversationId: 'conversation-stable', question: '再详细一点', generateTitle: false,
    });
    const resolve = createImageExplanationTaskDefinitionV1({ process: vi.fn() })
      .primaryWorkspaceConfig.resolveInstanceKey!;
    expect(resolve({ taskId: 'task-1', instruction: first.instruction }))
      .toBe('conversation-stable--revision-1');
    expect(resolve({ taskId: 'task-2', instruction: followUp.instruction }))
      .toBe('conversation-stable--revision-1');
    const nextRevision = createContribution(vi.fn(), 'revision-2')
      .createTaskRequest({
        projectId: 'project-1', assetId: 'asset-1',
        conversationId: 'conversation-stable', question: '新图片的追问',
        generateTitle: false,
      });
    expect(resolve({ taskId: 'task-3', instruction: nextRevision.instruction }))
      .toBe('conversation-stable--revision-2');
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
    const atPersistenceLimit = contribution.readTaskResult({
      result: {
        answer: 'x'.repeat(32_768),
        providerId: 'codex', modelId: 'gpt-test',
      },
    } as unknown as GenerationTaskView);
    const beyondPersistenceLimit = contribution.readTaskResult({
      result: {
        answer: 'x'.repeat(32_769),
        providerId: 'codex', modelId: 'gpt-test',
      },
    } as unknown as GenerationTaskView);
    expect(valid).toEqual({
      answer: '解释结果', title: '主题', modelInfo: 'codex/gpt-test',
    });
    expect(invalid).toBeUndefined();
    expect(atPersistenceLimit?.answer).toHaveLength(32_768);
    expect(beyondPersistenceLimit).toBeUndefined();
  });

  it('describes and reveals the exact image region through the Image Workbench', async () => {
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

  it('isolates context matching and persisted history by source revision', async () => {
    const firstContext = createImageConversationContext(target, 'revision-1');
    const secondContext = createImageConversationContext(target, 'revision-2');
    expect(conversationContextsEqual(firstContext, secondContext)).toBe(false);

    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    try {
      const firstStore = createImageConversationHistoryStore(
        'project-1', 'asset-1', 'image.conversation', 'revision-1',
      );
      const secondStore = createImageConversationHistoryStore(
        'project-1', 'asset-1', 'image.conversation', 'revision-2',
      );
      await firstStore.save({
        id: 'conv-1',
        title: '第一张图',
        messages: [{
          id: 'message-1', role: 'user', text: '请解释', createdTime: 1,
          context: firstContext,
        }],
        createdTime: 1,
        updatedTime: 1,
      });
      await expect(secondStore.list()).resolves.toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
