import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  AiChatPanel,
  AiChatProvider,
  cancelActiveDocumentAiRequest,
  sendDocumentAiMessage,
} from './AiChatPanel';
import { createAiChatStore } from './chat-store';

describe('AiChatPanel component state composition', () => {
  it('cancels the active GenerationTask when the component is cleared or unmounted', async () => {
    const cancelDocumentAi = vi.fn(async () => undefined);
    vi.stubGlobal('window', { learningCompanion: { cancelDocumentAi } });
    const store = createAiChatStore(() => 'conversation');
    let resolveRequest!: (value: { answer: string; providerId: string; modelId: string }) => void;
    let requestId = '';
    const pending = sendDocumentAiMessage({
      store, projectId: 'project', assetId: 'asset', content: 'question',
      ask: vi.fn((request) => {
        requestId = request.requestId;
        return new Promise<{ answer: string; providerId: string; modelId: string }>(
          (resolve) => { resolveRequest = resolve; },
        );
      }),
    });

    await cancelActiveDocumentAiRequest('asset');
    expect(cancelDocumentAi).toHaveBeenCalledWith(requestId);
    resolveRequest({ answer: 'ignored', providerId: 'p', modelId: 'm' });
    await pending;
    vi.unstubAllGlobals();
  });

  it('blocks duplicate sends, ignores a cleared in-flight reply, and permits retry', async () => {
    let sequence = 0;
    const store = createAiChatStore(() => `conversation-${++sequence}`);
    const response = { answer: 'answer', providerId: 'provider', modelId: 'model' };
    let resolveRequest!: (value: typeof response) => void;
    const ask = vi.fn(() => new Promise<typeof response>((resolve) => {
      resolveRequest = resolve;
    }));

    const first = sendDocumentAiMessage({
      store, projectId: 'project', assetId: 'asset', content: 'first', ask,
    });
    await expect(sendDocumentAiMessage({
      store, projectId: 'project', assetId: 'asset', content: 'duplicate', ask,
    })).resolves.toBe(false);
    expect(ask).toHaveBeenCalledOnce();

    store.clearSession('asset');
    resolveRequest(response);
    await expect(first).resolves.toBe(true);
    expect(store.getSession('asset')?.messages).toHaveLength(0);

    await expect(sendDocumentAiMessage({
      store, projectId: 'project', assetId: 'asset', content: 'retry',
      ask: vi.fn(async () => response),
    })).resolves.toBe(true);
    expect(store.getSession('asset')?.messages.map(({ content }) => content))
      .toEqual(['retry', 'answer']);
  });

  it('leaves the component session retryable after an Agent failure', async () => {
    const store = createAiChatStore(() => 'conversation');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(sendDocumentAiMessage({
      store, projectId: 'project', assetId: 'asset', content: 'fails',
      ask: vi.fn(async () => { throw new Error('offline'); }),
    })).resolves.toBe(false);
    expect(store.getSession('asset')?.loading).toBe(false);

    await expect(sendDocumentAiMessage({
      store, projectId: 'project', assetId: 'asset', content: 'retry',
      ask: vi.fn(async () => ({ answer: 'ok', providerId: 'p', modelId: 'm' })),
    })).resolves.toBe(true);
    expect(store.getSession('asset')?.messages.at(-1)?.content).toBe('ok');
    consoleError.mockRestore();
  });

  it('renders only the current Asset conversation and its loading state', () => {
    let sequence = 0;
    const store = createAiChatStore(() => `conversation-${++sequence}`);
    store.ensureSession('project', 'asset-a');
    store.ensureSession('project', 'asset-b');
    store.addUserMessage('asset-a', 'question for A');
    const b = store.addUserMessage('asset-b', 'question for B').messages.at(-1)!;
    store.addAssistantMessage('asset-b', 'answer for B', b.id);

    const html = renderToStaticMarkup(
      <AiChatProvider store={store}>
        <AiChatPanel
          projectId="project"
          assetId="asset-a"
          onClose={vi.fn()}
          onAttachAnswer={vi.fn()}
        />
      </AiChatProvider>,
    );

    expect(html).toContain('question for A');
    expect(html).not.toContain('question for B');
    expect(html).not.toContain('answer for B');
    expect(html).toContain('disabled=""');
  });

  it('renders a fresh conversation after clear without stale replies', () => {
    let sequence = 0;
    const store = createAiChatStore(() => `conversation-${++sequence}`);
    store.ensureSession('project', 'asset');
    const pending = store.addUserMessage('asset', 'old question').messages.at(-1)!;
    store.clearSession('asset');
    store.addAssistantMessage('asset', 'late answer', pending.id);

    const html = renderToStaticMarkup(
      <AiChatProvider store={store}>
        <AiChatPanel
          projectId="project"
          assetId="asset"
          onClose={vi.fn()}
          onAttachAnswer={vi.fn()}
        />
      </AiChatProvider>,
    );

    expect(html).not.toContain('old question');
    expect(html).not.toContain('late answer');
  });
});
