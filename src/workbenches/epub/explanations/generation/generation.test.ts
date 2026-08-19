import { describe, expect, it, vi } from 'vitest';

import { WORKBENCH_AGENT_PROVIDER_SELECTOR_ID } from '../../../../shared/agent-provider-selectors';
import { createEpubCfiRangeTarget } from '../../shared';
import {
  EPUB_DEFAULT_EXPLANATION_QUESTION,
  EPUB_EXPLANATION_INSTRUCTION_FORMAT,
  EPUB_EXPLANATION_INSTRUCTION_VERSION,
  EPUB_EXPLANATION_TASK_DEFINITION_ID,
  EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
} from '../shared';
import {
  EpubExplanationInstruction,
  epubExplanationInstructionFactory,
} from './instruction';
import {
  EPUB_EXPLANATION_SYSTEM_INSTRUCTION_V1,
  EpubExplanationProcessor,
} from './processor';
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

  it('keeps legacy notes task-isolated and reuses a stable conversation workspace', () => {
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
      permissions: { read: false, write: false },
    });
    const resolveInstanceKey =
      definition.primaryWorkspaceConfig.resolveInstanceKey!;
    expect(
      resolveInstanceKey({
        taskId: 'legacy-task',
        instruction: createInstruction().toSnapshot(),
      }),
    ).toBe('legacy-task');
    expect(
      resolveInstanceKey({
        taskId: 'conversation-task',
        instruction: new EpubExplanationInstruction({
          assetId: 'asset-1',
          conversationId: 'conversation-1',
          question: '这句话还有什么含义？',
          saveAsNote: false,
        }).toSnapshot(),
      }),
    ).toBe('conversation-1');
    expect(definition.assetReferenceSchema).toEqual({});
  });

  it('continues to parse pre-conversation note snapshots for recovery', () => {
    const target = createInstruction().target!;
    const parsed = epubExplanationInstructionFactory.parse({
      format: EPUB_EXPLANATION_INSTRUCTION_FORMAT,
      version: EPUB_EXPLANATION_INSTRUCTION_VERSION,
      assetId: 'asset-1',
      target: target as never,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      conversationId: undefined,
      question: EPUB_DEFAULT_EXPLANATION_QUESTION,
      saveAsNote: true,
      target,
    });
  });

  it('creates a complete Attachment only after the Agent answer succeeds', async () => {
    const call = vi.fn(async () => ({
      assistantOutput: '# 通俗解释\n正文',
      metrics: { providerId: 'codex', modelId: 'gpt-test' },
    }));
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
    const reportStatus = vi.fn();

    const result = await processor.process({
      taskId: 'task-1',
      projectId: 'project-1',
      instruction,
      agent: { call },
      preparedUserMessage: { role: 'user', content: [] },
      reportStatus,
    } as never);

    expect(result).toEqual({
      answer: '# 通俗解释\n正文',
      providerId: 'codex',
      modelId: 'gpt-test',
      attachmentId: 'attachment-1',
    });
    expect(call).toHaveBeenCalledWith(
      {
        callKey: 'explain',
        purpose: 'generation',
        systemInstruction: EPUB_EXPLANATION_SYSTEM_INSTRUCTION_V1,
        userMessage: { role: 'user', content: [] },
        toolRequirements: [],
        skills: [],
        mcpServers: [],
        assistantEvents: 'runtime',
      },
    );
    expect(reportStatus.mock.calls).toEqual([
      ['正在解释选中的文字…'],
      ['回答已生成，正在保存解释标注…'],
    ]);
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

  it('rejects an answer that the conversation history cannot persist', async () => {
    const createWithContent = vi.fn();
    const processor = new EpubExplanationProcessor({
      listByAsset: vi.fn(async () => []),
      createWithContent,
    } as never);

    await expect(processor.process({
      taskId: 'task-too-long',
      projectId: 'project-1',
      instruction: createInstruction(),
      agent: {
        call: vi.fn(async () => ({
          assistantOutput: 'x'.repeat(32_769),
          metrics: { providerId: 'codex', modelId: 'gpt-test' },
        })),
      },
      preparedUserMessage: { role: 'user', content: [] },
      reportStatus: vi.fn(),
    } as never)).rejects.toMatchObject({ code: 'GENERATION_OUTPUT_INVALID' });
    expect(createWithContent).not.toHaveBeenCalled();
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
        call: vi.fn(async () => ({
          assistantOutput: '已完成的回答',
          metrics: { providerId: 'codex', modelId: 'gpt-test' },
        })),
      },
      preparedUserMessage: { role: 'user', content: [] },
      reportStatus: vi.fn(),
    } as never);

    expect(result).toEqual({
      answer: '已完成的回答',
      providerId: 'codex',
      modelId: 'gpt-test',
      attachmentId: 'attachment-1',
    });
    expect(createWithContent).not.toHaveBeenCalled();
  });

  it('returns a follow-up answer in the same conversation without creating another Attachment', async () => {
    const createWithContent = vi.fn();
    const processor = new EpubExplanationProcessor({
      listByAsset: vi.fn(),
      createWithContent,
    } as never);
    const instruction = new EpubExplanationInstruction({
      assetId: 'asset-1',
      conversationId: 'conversation-1',
      question: '能再举一个例子吗？',
      saveAsNote: false,
    });
    const reportStatus = vi.fn();
    const call = vi.fn(async () => ({
      assistantOutput: '可以，例如……',
      metrics: { providerId: 'codex', modelId: 'gpt-test' },
    }));

    const result = await processor.process({
      taskId: 'task-2',
      projectId: 'project-1',
      instruction,
      agent: { call },
      preparedUserMessage: { role: 'user', content: [] },
      reportStatus,
    } as never);

    expect(result).toEqual({
      answer: '可以，例如……',
      providerId: 'codex',
      modelId: 'gpt-test',
    });
    expect(reportStatus).toHaveBeenCalledWith('正在回答追问…');
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        callKey: 'answer',
        purpose: 'epub-reading-conversation',
        assistantEvents: 'runtime',
      }),
    );
    expect(createWithContent).not.toHaveBeenCalled();
  });
});
