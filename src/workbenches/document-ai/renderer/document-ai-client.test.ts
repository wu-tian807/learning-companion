import { describe, expect, it, vi } from 'vitest';

import type { GenerationTaskView } from '../../../shared/generation-tasks';
import { createDocumentAiClient } from './document-ai-client';

const request = {
  projectId: 'project',
  assetId: 'asset',
  requestId: 'request',
  conversationId: 'conversation',
  question: '解释这段内容',
  target: { scope: 'asset' as const },
};

function completed(result: GenerationTaskView['result']): GenerationTaskView {
  return {
    id: 'task',
    projectId: 'project',
    definitionId: 'builtin.document-question',
    definitionVersion: 1,
    status: 'completed',
    result,
    metrics: {},
    createdTime: 1,
    updatedTime: 2,
  };
}

describe('DocumentAiClient', () => {
  it('uses the shared GenerationTask path and interprets its result', async () => {
    const run = vi.fn(async () => completed({
      answer: '回答',
      providerId: 'codex',
      modelId: 'gpt',
    }));
    const client = createDocumentAiClient(run);

    await expect(client.ask(request)).resolves.toEqual({
      answer: '回答',
      providerId: 'codex',
      modelId: 'gpt',
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project',
        assetReferences: { document: [{ assetId: 'asset' }] },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('aborts the matching task and rejects duplicate request ids', async () => {
    let signal: AbortSignal | undefined;
    const run = vi.fn((_request, options) => {
      signal = options.signal;
      return new Promise<GenerationTaskView>((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        );
      });
    });
    const client = createDocumentAiClient(run);
    const running = client.ask(request);

    await expect(client.ask(request)).rejects.toThrow('already active');
    client.cancel(request.requestId);
    expect(signal?.aborted).toBe(true);
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a completed task whose feature result is invalid', async () => {
    const client = createDocumentAiClient(
      vi.fn(async () => completed({ answer: '' })),
    );

    await expect(client.ask(request)).rejects.toThrow('invalid result');
  });
});
