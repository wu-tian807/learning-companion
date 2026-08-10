import { describe, expect, it, vi } from 'vitest';

import { WORKBENCH_AGENT_PROVIDER_SELECTOR_ID } from '../../../../shared/agent-provider-selectors';
import { createEpubCfiRangeTarget } from '../../shared';
import {
  EPUB_EXPLANATION_TASK_DEFINITION_ID,
  EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
} from '../shared';
import { EpubExplanationInstruction } from './instruction';
import { EpubExplanationProcessor } from './processor';
import { createEpubExplanationTaskDefinitionV1 } from './task-definition';

function createInstruction() {
  return new EpubExplanationInstruction({
    assetId: 'asset-1',
    target: createEpubCfiRangeTarget({
      cfiRange: 'epubcfi(/6/2!/4/2/1:0,/1:4)',
      quote: {
        exact: '需要解释的文字',
        prefix: '前面的内容',
        suffix: '后面的内容',
      },
    }),
  });
}

describe('EPUB explanation generation', () => {
  it('creates a fixed explanation message with selection context', () => {
    const instruction = createInstruction();
    const message = instruction.toUserMessage();
    const text = message.content[0];

    expect(instruction.toSnapshot()).toMatchObject({
      assetId: 'asset-1',
      target: expect.objectContaining({
        anchorPayload: expect.objectContaining({
          cfiRange: 'epubcfi(/6/2!/4/2/1:0,/1:4)',
        }),
      }),
    });
    expect(text).toMatchObject({ type: 'text' });
    expect(text.type === 'text' ? text.text : '').toContain(
      '<selection>\n需要解释的文字\n</selection>',
    );
  });

  it('uses an isolated tool-free task workspace', () => {
    const definition = createEpubExplanationTaskDefinitionV1({
      process: vi.fn(),
    });

    expect(definition.id).toBe(EPUB_EXPLANATION_TASK_DEFINITION_ID);
    expect(definition.version).toBe(
      EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
    );
    expect(definition.providerSelectorId).toBe(
      WORKBENCH_AGENT_PROVIDER_SELECTOR_ID,
    );
    expect(definition.primaryWorkspaceConfig).toMatchObject({
      scope: 'task',
      permissions: { read: false, write: false },
    });
    expect(definition.assetReferenceSchema).toEqual({});
  });

  it('creates a complete Attachment only after the Agent answer succeeds', async () => {
    const call = vi.fn(async () => ({ assistantOutput: '# 通俗解释\n正文' }));
    const createWithContent = vi.fn(async (input) => ({
      ...input,
      id: 'attachment-1',
      content: {
        ref: {
          base: 'project-workspace' as const,
          path: 'attachments/attachment-1/answer.md',
        },
        mediaType: 'text/markdown',
      },
      createdTime: 1,
      updatedTime: 1,
    }));
    const processor = new EpubExplanationProcessor({
      listByAsset: vi.fn(async () => []),
      createWithContent,
    } as never);
    const instruction = createInstruction();

    const result = await processor.process({
      taskId: 'task-1',
      projectId: 'project-1',
      instruction,
      agent: { call },
      defaultUserMessage: { role: 'user', content: [] },
      reportStatus: vi.fn(),
    } as never);

    expect(result).toEqual({ attachmentId: 'attachment-1' });
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ assistantEvents: 'none' }),
    );
    expect(createWithContent).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'asset-1',
        metadata: {
          format: 'learning-companion/epub-explanation',
          version: 1,
        },
        content: {
          fileName: 'answer.md',
          mediaType: 'text/markdown',
          data: '# 通俗解释\n正文\n',
        },
      }),
    );
  });

  it('reuses the completed Attachment when process is replayed after a crash', async () => {
    const instruction = createInstruction();
    const createWithContent = vi.fn();
    const processor = new EpubExplanationProcessor({
      listByAsset: vi.fn(async () => [
        {
          id: 'attachment-1',
          projectId: 'project-1',
          assetId: 'asset-1',
          typeId: 'epub.ai-explanation',
          typeVersion: 1,
          target: instruction.target,
          metadata: {
            format: 'learning-companion/epub-explanation',
            version: 1,
          },
          content: {
            ref: {
              base: 'project-workspace',
              path: 'attachments/attachment-1/answer.md',
            },
            mediaType: 'text/markdown',
          },
          createdTime: 1,
          updatedTime: 1,
        },
      ]),
      createWithContent,
    } as never);

    const result = await processor.process({
      taskId: 'task-1',
      projectId: 'project-1',
      instruction,
      agent: {
        call: vi.fn(async () => ({ assistantOutput: '已完成的回答' })),
      },
      defaultUserMessage: { role: 'user', content: [] },
      reportStatus: vi.fn(),
    } as never);

    expect(result).toEqual({ attachmentId: 'attachment-1' });
    expect(createWithContent).not.toHaveBeenCalled();
  });
});
