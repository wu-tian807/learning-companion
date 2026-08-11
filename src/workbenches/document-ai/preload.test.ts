import { describe, expect, it, vi } from 'vitest';

import { createDocumentAiPreloadApi } from './preload';
import { DOCUMENT_AI_IPC_CHANNELS } from './shared';

describe('Document AI Preload API', () => {
  it('owns the document question channel', async () => {
    const invoke = vi.fn(async () => ({
      answer: 'answer', providerId: 'provider', modelId: 'model',
    }));
    const api = createDocumentAiPreloadApi({} as never, invoke as never);
    const request = {
      projectId: 'project-1', assetId: 'asset-1', requestId: 'request-1', conversationId: 'conversation-1', question: 'why?',
      target: { scope: 'asset' as const },
    };

    await expect(api.askDocumentAi(request)).resolves.toEqual({
      answer: 'answer', providerId: 'provider', modelId: 'model',
    });
    expect(invoke).toHaveBeenCalledWith(DOCUMENT_AI_IPC_CHANNELS.ask, request);
    await api.cancelDocumentAi('request-1');
    expect(invoke).toHaveBeenCalledWith(DOCUMENT_AI_IPC_CHANNELS.cancel, 'request-1');
  });
});
