import { describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '../../shared/workbench/protocol';

import { askDocumentAi, isDocumentAiRequest } from './ipc';
import { documentQuestionInstructionFactory } from './generation/document-question-instruction';

describe('Document AI IPC composition', () => {
  const completedRun = (result: unknown) => ({
    next: vi.fn(async () => ({ done: true as const, value: { result } })),
    [Symbol.asyncIterator]() { return this; },
  });

  it.each([
    undefined,
    {},
    { projectId: '', assetId: 'a', question: 'q', target: { scope: 'asset' } },
    { projectId: 'p', assetId: '', question: 'q', target: { scope: 'asset' } },
    { projectId: 'p', assetId: 'a', question: '', target: { scope: 'asset' } },
    { projectId: 'p', assetId: 'a', question: 'q', target: { scope: 'content' } },
    { projectId: 'p', assetId: 'a', question: 'q', target: { scope: 'asset' }, selectedImageDataUrl: 'data:text/plain;base64,QQ==' },
  ])('rejects malformed request %#', (value) => {
    expect(isDocumentAiRequest(value)).toBe(false);
  });

  it('creates and completes a GenerationTask instead of calling a provider directly', async () => {
    const create = vi.fn(() => ({ id: 'task-1' }));
    const run = vi.fn(() => completedRun({
      answer: 'answer', providerId: 'provider', modelId: 'model',
    }));

    await expect(askDocumentAi({ create, run } as never, {
      projectId: ' project-1 ', assetId: ' asset-1 ', conversationId: 'conversation-1', question: 'why?',
      target: { scope: 'asset' }, selectedText: 'selection',
    })).resolves.toEqual({ answer: 'answer', providerId: 'provider', modelId: 'model' });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      assetReferences: { document: [{ assetId: 'asset-1' }] },
    }));
    const createdInput = (
      create.mock.calls as unknown as [[{ instruction: JsonValue }]]
    )[0][0];
    const parsed = documentQuestionInstructionFactory.parse(createdInput.instruction);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Expected a valid instruction');
    expect(parsed.value.conversationId).toBe('conversation-1');
    expect(parsed.value.toUserMessage({
      assetReferences: {
        document: [{
          alias: 'document', assetId: 'asset-1', name: 'file.pdf',
          mediaType: 'application/pdf', contentRevision: 'revision',
          relativePath: 'references/document/file.pdf',
        }],
      },
    } as never).content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Target anchor'),
    });
    expect(run).toHaveBeenCalledWith('task-1');
  });

  it('rejects a malformed persisted task result', async () => {
    const run = () => completedRun({ answer: '' });
    await expect(askDocumentAi({ create: () => ({ id: 'task-1' }), run } as never, {
      projectId: 'p', assetId: 'a', conversationId: 'conversation-1', question: 'q', target: { scope: 'asset' },
    })).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
  });
});
