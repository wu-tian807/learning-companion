import { describe, expect, it, vi } from 'vitest';

vi.mock('./image-input-preparer', () => ({
  prepareImageExplanationInputs: vi.fn(async () => ({
    overviewPath: 'C:\\workspace\\overview.png',
    markedOverviewPath: 'C:\\workspace\\marked.png',
    cropPath: 'C:\\workspace\\crop.png',
  })),
}));

import { WORKBENCH_AGENT_PROVIDER_SELECTOR_ID } from '../../../../shared/agent-provider-selectors';
import type { TaskAgentCallRequest } from '../../../../main/generation/contracts/task-definition';
import { createImageRegionTarget } from '../../shared';
import {
  IMAGE_DEFAULT_EXPLANATION_QUESTION,
  IMAGE_EXPLANATION_INSTRUCTION_FORMAT,
  IMAGE_EXPLANATION_INSTRUCTION_VERSION,
} from '../shared';
import {
  ImageExplanationInstruction,
  imageExplanationInstructionFactory,
} from './instruction';
import { prepareImageExplanationInputs } from './image-input-preparer';
import {
  IMAGE_EXPLANATION_SYSTEM_INSTRUCTION_V1,
  ImageExplanationProcessor,
} from './processor';
import { createImageExplanationTaskDefinitionV1 } from './task-definition';

function createInstruction() {
  return new ImageExplanationInstruction({
    assetId: 'asset-1',
    target: createImageRegionTarget({
      x: 0.1, y: 0.2, width: 0.3, height: 0.4,
      sourceWidth: 1200, sourceHeight: 800,
    }),
  });
}

describe('image explanation generation', () => {
  it('keeps legacy tasks isolated and reuses a stable conversation workspace', () => {
    const definition = createImageExplanationTaskDefinitionV1({ process: vi.fn() });
    expect(definition.providerSelectorId).toBe(WORKBENCH_AGENT_PROVIDER_SELECTOR_ID);
    expect(definition.primaryWorkspaceConfig).toMatchObject({ permissions: { read: true, write: false } });
    const resolveInstanceKey = definition.primaryWorkspaceConfig.resolveInstanceKey!;
    expect(resolveInstanceKey({
      taskId: 'legacy-task',
      instruction: createInstruction().toSnapshot(),
    })).toBe('legacy-task');
    expect(resolveInstanceKey({
      taskId: 'conversation-task',
      instruction: new ImageExplanationInstruction({
        assetId: 'asset-1',
        conversationId: 'conversation-1',
        question: '这个箭头表示什么？',
        saveAsNote: false,
      }).toSnapshot(),
    })).toBe('conversation-1');
    expect(definition.assetReferenceSchema.image).toMatchObject({
      required: true,
      cardinality: 'one',
      acceptedMediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'],
    });
  });

  it('continues to parse pre-conversation image note snapshots for recovery', () => {
    const target = createInstruction().target!;
    const parsed = imageExplanationInstructionFactory.parse({
      format: IMAGE_EXPLANATION_INSTRUCTION_FORMAT,
      version: IMAGE_EXPLANATION_INSTRUCTION_VERSION,
      assetId: 'asset-1',
      target: target as never,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      conversationId: undefined,
      question: IMAGE_DEFAULT_EXPLANATION_QUESTION,
      saveAsNote: true,
      target,
    });
  });

  it('rejects malformed targetless tasks that cannot belong to a conversation', () => {
    const parsed = imageExplanationInstructionFactory.parse({
      format: IMAGE_EXPLANATION_INSTRUCTION_FORMAT,
      version: IMAGE_EXPLANATION_INSTRUCTION_VERSION,
      assetId: 'asset-1',
      question: '没有上下文的问题',
      saveAsNote: false,
    });
    expect(parsed.ok).toBe(false);
    expect(() => new ImageExplanationInstruction({
      assetId: 'asset-1',
      conversationId: '包含 空格',
      question: '无效会话',
      saveAsNote: false,
    })).toThrow('图片解释对话任务数据无效');
  });

  it('sends whole, marked, and cropped images in one vision call', async () => {
    const call = vi.fn(async (request: TaskAgentCallRequest) => {
      void request;
      return {
        assistantOutput: '这是图表中的关键节点。',
        metrics: { providerId: 'codex', modelId: 'gpt-test' },
      };
    });
    const createWithContent = vi.fn(async (input) => ({ ...input, id: 'attachment-1' }));
    const processor = new ImageExplanationProcessor({
      listByAsset: vi.fn(async () => []),
      createWithContent,
    } as never);
    const instruction = createInstruction();
    const reportStatus = vi.fn();

    const result = await processor.process({
      taskId: 'task-1',
      projectId: 'project-1',
      instruction,
      workspaces: { primary: { path: 'C:\\workspace' } },
      assetReferences: {
        image: [{
          alias: 'image-0001', assetId: 'asset-1', name: 'diagram.png',
          mediaType: 'image/png', contentRevision: 'revision-1',
          relativePath: 'references/image-0001/source.png',
        }],
      },
      preparedUserMessage: instruction.toUserMessage(),
      agent: { call },
      reportStatus,
    } as never);

    expect(result).toEqual({
      answer: '这是图表中的关键节点。',
      providerId: 'codex',
      modelId: 'gpt-test',
      attachmentId: 'attachment-1',
    });
    const request = call.mock.calls[0]?.[0];
    expect(request?.systemInstruction).toBe(IMAGE_EXPLANATION_SYSTEM_INSTRUCTION_V1);
    expect(request?.assistantEvents).toBe('runtime');
    expect(request?.toolRequirements).toEqual([]);
    expect(request?.userMessage.content.filter((part) => part.type === 'local-image')).toEqual([
      { type: 'local-image', path: 'C:\\workspace\\overview.png', detail: 'high' },
      { type: 'local-image', path: 'C:\\workspace\\marked.png', detail: 'high' },
      { type: 'local-image', path: 'C:\\workspace\\crop.png', detail: 'original' },
    ]);
    expect(createWithContent).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'image.ai-explanation',
      target: instruction.target,
      metadata: {
        format: 'learning-companion/image-explanation',
        version: 1,
        sourceRevision: 'revision-1',
      },
      content: {
        fileName: 'answer.md', mediaType: 'text/markdown',
        data: '这是图表中的关键节点。\n',
      },
    }));
    expect(reportStatus.mock.calls).toEqual([
      ['正在准备整图、兴趣区域标注和局部放大图…'],
      ['正在结合整张图片解释兴趣区域…'],
      ['回答已生成，正在保存图片解释标注…'],
    ]);
  });

  it('rejects a missing prepared image reference before calling the model', async () => {
    const call = vi.fn();
    const processor = new ImageExplanationProcessor({} as never);
    await expect(processor.process({
      instruction: createInstruction(),
      assetReferences: {},
      agent: { call },
    } as never)).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
    expect(call).not.toHaveBeenCalled();
  });

  it('reuses an Attachment with the same region and source revision after recovering an answer', async () => {
    const instruction = createInstruction();
    const call = vi.fn(async () => ({
      assistantOutput: '恢复后的解释',
      metrics: { providerId: 'codex', modelId: 'gpt-test' },
    }));
    const createWithContent = vi.fn();
    const processor = new ImageExplanationProcessor({
      listByAsset: vi.fn(async () => [{
        id: 'attachment-1',
        typeId: 'image.ai-explanation',
        typeVersion: 1,
        target: instruction.target,
        metadata: {
          format: 'learning-companion/image-explanation',
          version: 1,
          sourceRevision: 'revision-1',
        },
        content: { mediaType: 'text/markdown' },
      }]),
      createWithContent,
    } as never);

    const result = await processor.process({
      projectId: 'project-1',
      instruction,
      workspaces: { primary: { path: 'C:\\workspace' } },
      assetReferences: {
        image: [{
          contentRevision: 'revision-1',
          relativePath: 'references/image-0001/source.png',
        }],
      },
      agent: { call },
      preparedUserMessage: instruction.toUserMessage(),
      reportStatus: vi.fn(),
    } as never);

    expect(result).toEqual({
      answer: '恢复后的解释',
      providerId: 'codex',
      modelId: 'gpt-test',
      attachmentId: 'attachment-1',
    });
    expect(call).toHaveBeenCalledOnce();
    expect(createWithContent).not.toHaveBeenCalled();
  });

  it('creates a new Attachment for the same region when the source revision changed', async () => {
    const instruction = createInstruction();
    const createWithContent = vi.fn(async (input) => ({
      ...input,
      id: 'attachment-current',
    }));
    const processor = new ImageExplanationProcessor({
      listByAsset: vi.fn(async () => [{
        id: 'attachment-stale',
        typeId: 'image.ai-explanation',
        typeVersion: 1,
        target: instruction.target,
        metadata: {
          format: 'learning-companion/image-explanation',
          version: 1,
          sourceRevision: 'revision-1',
        },
        content: { mediaType: 'text/markdown' },
      }]),
      createWithContent,
    } as never);

    const result = await processor.process({
      projectId: 'project-1',
      instruction,
      workspaces: { primary: { path: 'C:\\workspace' } },
      assetReferences: { image: [{
        contentRevision: 'revision-2',
        relativePath: 'references/image-0001/source.png',
      }] },
      preparedUserMessage: instruction.toUserMessage(),
      agent: { call: vi.fn(async () => ({
        assistantOutput: '新图片的解释',
        metrics: { providerId: 'codex', modelId: 'gpt-test' },
      })) },
      reportStatus: vi.fn(),
    } as never);

    expect(result).toMatchObject({ attachmentId: 'attachment-current' });
    expect(createWithContent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ sourceRevision: 'revision-2' }),
    }));
  });

  it('answers a follow-up in the same conversation without reprocessing images or creating a Note', async () => {
    vi.mocked(prepareImageExplanationInputs).mockClear();
    const listByAsset = vi.fn();
    const createWithContent = vi.fn();
    const processor = new ImageExplanationProcessor({
      listByAsset,
      createWithContent,
    } as never);
    const instruction = new ImageExplanationInstruction({
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: '这个节点为什么重要？',
      saveAsNote: false,
    });
    const reportStatus = vi.fn();
    const call = vi.fn(async () => ({
      assistantOutput: '因为它连接了上下游流程。',
      metrics: { providerId: 'codex', modelId: 'gpt-test' },
    }));
    const result = await processor.process({
      taskId: 'task-2',
      projectId: 'project-1',
      instruction,
      assetReferences: { image: [{ contentRevision: 'revision-1' }] },
      preparedUserMessage: instruction.toUserMessage(),
      agent: { call },
      reportStatus,
    } as never);
    expect(result).toEqual({
      answer: '因为它连接了上下游流程。',
      providerId: 'codex',
      modelId: 'gpt-test',
    });
    expect(reportStatus).toHaveBeenCalledWith('正在回答图片追问…');
    expect(call).toHaveBeenCalledWith(expect.objectContaining({
      callKey: 'answer',
      purpose: 'image-reading-conversation',
      userMessage: instruction.toUserMessage(),
    }));
    expect(prepareImageExplanationInputs).not.toHaveBeenCalled();
    expect(listByAsset).not.toHaveBeenCalled();
    expect(createWithContent).not.toHaveBeenCalled();
  });

  it('extracts a generated conversation title without saving the protocol tag in the Note', async () => {
    const call = vi.fn(async () => ({
      assistantOutput: '<conversation-title>流程图关键节点</conversation-title>\n这是解释正文。',
      metrics: { providerId: 'codex', modelId: 'gpt-test' },
    }));
    const processor = new ImageExplanationProcessor({
      listByAsset: vi.fn(async () => []),
      createWithContent: vi.fn(async (input) => ({ ...input, id: 'attachment-1' })),
    } as never);
    const instruction = new ImageExplanationInstruction({
      assetId: 'asset-1',
      target: createInstruction().target,
      conversationId: 'conversation-1',
      question: IMAGE_DEFAULT_EXPLANATION_QUESTION,
      saveAsNote: true,
      generateTitle: true,
    });
    const result = await processor.process({
      projectId: 'project-1',
      instruction,
      workspaces: { primary: { path: 'C:\\workspace' } },
      assetReferences: { image: [{
        contentRevision: 'revision-1',
        relativePath: 'references/image-0001/source.png',
      }] },
      preparedUserMessage: instruction.toUserMessage(),
      agent: { call },
      reportStatus: vi.fn(),
    } as never);
    expect(result).toMatchObject({
      title: '流程图关键节点',
      answer: '这是解释正文。',
      attachmentId: 'attachment-1',
    });
    expect(call).toHaveBeenCalledWith(expect.objectContaining({
      callKey: 'answer',
      purpose: 'image-reading-conversation',
      userMessage: expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'local-image', detail: 'original' }),
        ]),
      }),
    }));
  });

  it('does not create a Note when the first conversational answer is invalid', async () => {
    const createWithContent = vi.fn();
    const processor = new ImageExplanationProcessor({
      listByAsset: vi.fn(async () => []),
      createWithContent,
    } as never);
    const instruction = new ImageExplanationInstruction({
      assetId: 'asset-1',
      target: createInstruction().target,
      conversationId: 'conversation-1',
      question: IMAGE_DEFAULT_EXPLANATION_QUESTION,
      saveAsNote: true,
      generateTitle: true,
    });
    await expect(processor.process({
      projectId: 'project-1',
      instruction,
      workspaces: { primary: { path: 'C:\\workspace' } },
      assetReferences: { image: [{
        contentRevision: 'revision-1',
        relativePath: 'references/image-0001/source.png',
      }] },
      preparedUserMessage: instruction.toUserMessage(),
      agent: { call: vi.fn(async () => ({
        assistantOutput: '<conversation-title>只有标题</conversation-title>',
        metrics: { providerId: 'codex', modelId: 'gpt-test' },
      })) },
      reportStatus: vi.fn(),
    } as never)).rejects.toMatchObject({ code: 'GENERATION_OUTPUT_INVALID' });
    expect(createWithContent).not.toHaveBeenCalled();
  });
});
