import { describe, expect, it, vi } from 'vitest';

import {
  EPUB_EXPLANATION_TASK_DEFINITION_ID,
  EPUB_EXPLANATION_TASK_DEFINITION_VERSION,
} from '../shared';
import { EpubExplanationInstruction } from './instruction';
import { EpubExplanationProcessor } from './processor';
import { createEpubExplanationTaskDefinitionV1 } from './task-definition';
import { WORKBENCH_AGENT_PROVIDER_SELECTOR_ID } from '../../../../shared/agent-provider-selectors';

describe('EPUB explanation generation', () => {
  it('creates a fixed explanation message with selection context', () => {
    const instruction = new EpubExplanationInstruction({
      attachmentId: 'attachment-1',
      exact: '需要解释的文字',
      prefix: '前面的内容',
      suffix: '后面的内容',
    });
    const message = instruction.toUserMessage();
    const text = message.content[0];

    expect(instruction.toSnapshot()).toMatchObject({
      attachmentId: 'attachment-1',
      exact: '需要解释的文字',
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

  it('persists the final Agent answer without forwarding assistant events', async () => {
    const call = vi.fn(async () => ({ assistantOutput: '# 通俗解释\n正文' }));
    const update = vi.fn(async () => undefined);
    const write = vi.fn(async () => ({
      ref: { base: 'project-workspace' as const, path: 'attachments/a/answer.md' },
      mediaType: 'text/markdown',
    }));
    const processor = new EpubExplanationProcessor(
      {
        get: vi.fn(async () => ({
          id: 'attachment-1',
          projectId: 'project-1',
          assetId: 'asset-1',
          typeId: 'epub.ai-explanation',
          typeVersion: 1,
          target: { scope: 'asset' },
          metadata: {
            format: 'learning-companion/epub-explanation',
            version: 1,
            status: 'pending',
            taskId: 'task-1',
          },
          createdTime: 1,
          updatedTime: 1,
        })),
        update,
      } as never,
      { write } as never,
    );

    await processor.process({
      taskId: 'task-1',
      projectId: 'project-1',
      instruction: { attachmentId: 'attachment-1' },
      agent: { call },
      defaultUserMessage: { role: 'user', content: [] },
      reportStatus: vi.fn(),
    } as never);

    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ assistantEvents: 'none' }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'answer.md',
        mediaType: 'text/markdown',
        content: '# 通俗解释\n正文\n',
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: 'attachment-1',
        metadata: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('rejects a stale task before it can overwrite a newer Attachment owner', async () => {
    const write = vi.fn();
    const processor = new EpubExplanationProcessor(
      {
        get: vi.fn(async () => ({
          id: 'attachment-1',
          projectId: 'project-1',
          assetId: 'asset-1',
          typeId: 'epub.ai-explanation',
          typeVersion: 1,
          target: { scope: 'asset' },
          metadata: {
            format: 'learning-companion/epub-explanation',
            version: 1,
            status: 'pending',
            taskId: 'new-task',
          },
          createdTime: 1,
          updatedTime: 2,
        })),
      } as never,
      { write } as never,
    );

    await expect(
      processor.process({
        taskId: 'old-task',
        projectId: 'project-1',
        instruction: { attachmentId: 'attachment-1' },
        agent: {
          call: vi.fn(async () => ({ assistantOutput: '旧任务回答' })),
        },
        defaultUserMessage: { role: 'user', content: [] },
        reportStatus: vi.fn(),
      } as never),
    ).rejects.toThrow('OPERATION_SUPERSEDED');
    expect(write).not.toHaveBeenCalled();
  });
});
