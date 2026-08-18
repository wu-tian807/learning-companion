import { describe, expect, it, vi } from 'vitest';

import type { GenerationTaskView } from '../../../shared/generation-tasks';
import { createEpubCfiRangeTarget } from '../shared';
import {
  createEpubConversationContext,
  createEpubConversationContribution,
} from './epub-conversation-contribution';
import { EPUB_DEFAULT_EXPLANATION_QUESTION } from './shared';
import { createEpubExplanationTaskDefinitionV1 } from './generation/task-definition';

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
    assetId: 'asset-1',
    historyStore: {
      list: async () => [],
      save: async (record) => [record],
      remove: async () => [],
    },
    revealContext: vi.fn(),
  });
}

describe('EPUB conversation contribution', () => {
  it('首次解释携带 CFI 选区并要求保存 Note', () => {
    const contribution = createContribution();
    const request = contribution.createTaskRequest({
      projectId: 'project-1',
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: EPUB_DEFAULT_EXPLANATION_QUESTION,
      context: createEpubConversationContext(target),
      generateTitle: true,
    });

    expect(request).toMatchObject({
      projectId: 'project-1',
      definitionId: 'epub.explain-selection',
      definitionVersion: 1,
      instruction: {
        conversationId: 'conversation-1',
        question: EPUB_DEFAULT_EXPLANATION_QUESTION,
        target,
        saveAsNote: true,
        generateTitle: true,
      },
      assetReferences: {},
    });
  });

  it('后续追问仅继续稳定对话，不重复创建 Note', () => {
    const request = createContribution().createTaskRequest({
      projectId: 'project-1',
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: '这里的“它”指什么？',
      generateTitle: false,
    });

    expect(request.instruction).toMatchObject({
      conversationId: 'conversation-1',
      question: '这里的“它”指什么？',
      saveAsNote: false,
    });
    expect(request.instruction).not.toHaveProperty('target');
  });

  it('从 Renderer 请求到 TaskDefinition 都用同一 conversationId 分区 Session', () => {
    const contribution = createContribution();
    const first = contribution.createTaskRequest({
      projectId: 'project-1',
      assetId: 'asset-1',
      conversationId: 'conversation-stable',
      question: EPUB_DEFAULT_EXPLANATION_QUESTION,
      context: createEpubConversationContext(target),
      generateTitle: true,
    });
    const followUp = contribution.createTaskRequest({
      projectId: 'project-1',
      assetId: 'asset-1',
      conversationId: 'conversation-stable',
      question: '再详细一点',
      generateTitle: false,
    });
    const definition = createEpubExplanationTaskDefinitionV1({
      process: vi.fn(),
    });
    const resolve = definition.primaryWorkspaceConfig.resolveInstanceKey!;

    expect(
      resolve({ taskId: 'task-1', instruction: first.instruction }),
    ).toBe('conversation-stable');
    expect(
      resolve({ taskId: 'task-2', instruction: followUp.instruction }),
    ).toBe('conversation-stable');
  });

  it('拒绝在没有 EPUB 选区时开始新对话', () => {
    expect(() =>
      createContribution().createTaskRequest({
        projectId: 'project-1',
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '请解释',
        generateTitle: true,
      }),
    ).toThrow('请先在 EPUB 中选中一段文字');
  });

  it('只消费经过验证的最终回答，并保留模型信息', () => {
    const contribution = createContribution();
    const valid = contribution.readTaskResult({
      result: {
        answer: '解释结果',
        title: '主题',
        providerId: 'codex',
        modelId: 'gpt-test',
      },
    } as unknown as GenerationTaskView);
    const invalid = contribution.readTaskResult({
      result: { answer: '' },
    } as unknown as GenerationTaskView);

    expect(valid).toEqual({
      answer: '解释结果',
      title: '主题',
      modelInfo: 'codex/gpt-test',
    });
    expect(invalid).toBeUndefined();
  });

  it('展示选中原文并把定位交回 EPUB Workbench', async () => {
    const revealContext = vi.fn();
    const contribution = createEpubConversationContribution({
      assetId: 'asset-1',
      historyStore: {
        list: async () => [],
        save: async (record) => [record],
        remove: async () => [],
      },
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
