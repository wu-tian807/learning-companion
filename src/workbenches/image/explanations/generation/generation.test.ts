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
import { ImageExplanationInstruction } from './instruction';
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
  it('uses a task-isolated image reference workspace', () => {
    const definition = createImageExplanationTaskDefinitionV1({ process: vi.fn() });
    expect(definition.providerSelectorId).toBe(WORKBENCH_AGENT_PROVIDER_SELECTOR_ID);
    expect(definition.primaryWorkspaceConfig).toMatchObject({ permissions: { read: true, write: false } });
    expect(definition.assetReferenceSchema.image).toMatchObject({
      required: true,
      cardinality: 'one',
      acceptedMediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'],
    });
  });

  it('sends whole, marked, and cropped images in one vision call', async () => {
    const call = vi.fn(async (request: TaskAgentCallRequest) => {
      void request;
      return { assistantOutput: '这是图表中的关键节点。' };
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

    expect(result).toEqual({ attachmentId: 'attachment-1' });
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
      ['正在保存图片 AI 解释…'],
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

  it('reuses an Attachment with the same region and source revision before image processing', async () => {
    const instruction = createInstruction();
    const call = vi.fn();
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
      assetReferences: {
        image: [{ contentRevision: 'revision-1' }],
      },
      agent: { call },
    } as never);

    expect(result).toEqual({ attachmentId: 'attachment-1' });
    expect(call).not.toHaveBeenCalled();
    expect(createWithContent).not.toHaveBeenCalled();
  });
});
