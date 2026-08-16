import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  AiChatPanel,
  AiChatProvider,
  cancelActiveDocumentAiRequest,
  documentAiErrorMessage,
  sendDocumentAiMessage,
} from './AiChatPanel';
import { AiChatPanelHost } from './AiChatPanelHost';
import { createAiChatStore } from './chat-store';

describe('AiChatPanel component state composition', () => {
  it('cancels the active GenerationTask when the component is cleared or unmounted', async () => {
    const cancelGenerationTask = vi.fn(async () => undefined);
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

    await cancelActiveDocumentAiRequest('asset', {
      cancel: cancelGenerationTask,
    });
    expect(cancelGenerationTask).toHaveBeenCalledWith(requestId);
    resolveRequest({ answer: 'ignored', providerId: 'p', modelId: 'm' });
    await pending;
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
    expect(store.getSession('asset')?.error).toContain('AI 回答失败');

    await expect(sendDocumentAiMessage({
      store, projectId: 'project', assetId: 'asset', content: 'retry',
      ask: vi.fn(async () => ({ answer: 'ok', providerId: 'p', modelId: 'm' })),
    })).resolves.toBe(true);
    expect(store.getSession('asset')?.messages.at(-1)?.content).toBe('ok');
    consoleError.mockRestore();
  });

  it('uses the selected region conversation as the Provider conversation identity', async () => {
    let sequence = 0;
    const store = createAiChatStore(() => `id-${++sequence}`);
    const requests: Array<{ conversationId: string }> = [];
    const ask = vi.fn(async (request) => {
      requests.push(request);
      return { answer: 'ok', providerId: 'p', modelId: 'm' };
    });
    const anchor = (pageNumber: number) => ({
      target: {
        scope: 'content' as const,
        anchorType: 'pdf.region',
        anchorVersion: 1,
        anchorPayload: { pageNumber, x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      },
      pageNumber,
    });

    await sendDocumentAiMessage({
      store, projectId: 'project', assetId: 'asset', content: '区域一',
      anchor: anchor(1), ask,
    });
    await sendDocumentAiMessage({
      store, projectId: 'project', assetId: 'asset', content: '区域二',
      anchor: anchor(2), ask,
    });
    const firstConversation = store.getConversations('asset')
      .find(({ title }) => title === '区域一')!;
    store.selectConversation('asset', firstConversation.id);
    await sendDocumentAiMessage({
      store, projectId: 'project', assetId: 'asset', content: '继续问', ask,
    });

    expect(requests[0]?.conversationId).not.toBe(requests[1]?.conversationId);
    expect(requests[2]?.conversationId).toBe(requests[0]?.conversationId);
  });

  it('shows a persistent model setup error instead of failing silently', async () => {
    const store = createAiChatStore(() => 'conversation');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await sendDocumentAiMessage({
      store, projectId: 'project', assetId: 'asset', content: 'question',
      ask: vi.fn(async () => { throw new Error('No provider/model connection configured'); }),
    });

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
    expect(documentAiErrorMessage(new Error('No provider configured')))
      .toContain('尚未配置可用模型');
    expect(html).toContain('role="alert"');
    expect(html).toContain('尚未配置可用模型');
    consoleError.mockRestore();
  });

  it('leaves the closed question launcher to the document header action slot', () => {
    const store = createAiChatStore();
    const html = renderToStaticMarkup(
      <AiChatPanelHost
        store={store}
        projectId="project"
        assetId="asset"
        onAttachAnswer={vi.fn()}
      />,
    );
    expect(html).toBe('');
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

  it('renders a persisted question source card with its page and selected text', () => {
    const store = createAiChatStore(() => 'conversation');
    store.ensureSession('project', 'asset');
    store.addUserMessage('asset', '这是什么意思？', {
      target: {
        scope: 'content',
        anchorType: 'pdf.text-range',
        anchorVersion: 1,
        anchorPayload: { pageNumber: 6, start: 1, end: 8 },
      },
      pageNumber: 6,
      selectedText: '查询向量与键向量的关系',
    });

    const html = renderToStaticMarkup(
      <AiChatProvider store={store}>
        <AiChatPanel
          projectId="project"
          assetId="asset"
          onClose={vi.fn()}
        />
      </AiChatProvider>,
    );

    expect(html).toContain('data-ai-question-source="selection"');
    expect(html).toContain('第 6 页');
    expect(html).toContain('查询向量与键向量的关系');
  });

  it('does not add a pending selection preview to history before a question is sent', () => {
    const store = createAiChatStore(() => 'conversation');
    store.ensureSession('project', 'asset');
    store.setPendingAnchor('asset', {
      target: {
        scope: 'content',
        anchorType: 'pdf.region',
        anchorVersion: 1,
        anchorPayload: {
          pageNumber: 3,
          x: 0.1,
          y: 0.2,
          width: 0.5,
          height: 0.3,
        },
      },
      pageNumber: 3,
      previewDataUrl: 'data:image/jpeg;base64,cHJldmlldw==',
    });

    const html = renderToStaticMarkup(
      <AiChatProvider store={store}>
        <AiChatPanel
          projectId="project"
          assetId="asset"
          onClose={vi.fn()}
        />
      </AiChatProvider>,
    );

    expect(html).not.toContain('data-ai-question-source="selection"');
    expect(html).not.toContain('data:image/jpeg;base64,cHJldmlldw==');
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

  it('hides unavailable attachment actions while keeping answer tools', () => {
    const store = createAiChatStore(() => 'conversation');
    store.ensureSession('project', 'asset');
    const question = store.addUserMessage('asset', 'question').messages.at(-1)!;
    store.addAssistantMessage('asset', 'answer', question.id);

    const html = renderToStaticMarkup(
      <AiChatProvider store={store}>
        <AiChatPanel
          projectId="project"
          assetId="asset"
          onClose={vi.fn()}
        />
      </AiChatProvider>,
    );

    expect(html).not.toContain('附着整段');
    expect(html).not.toContain('附着选中内容');
    expect(html).toContain('复制');
    expect(html).toContain('继续追问');

    const attachmentHtml = renderToStaticMarkup(
      <AiChatProvider store={store}>
        <AiChatPanel
          projectId="project"
          assetId="asset"
          onClose={vi.fn()}
          onAttachAnswer={vi.fn()}
        />
      </AiChatProvider>,
    );

    expect(attachmentHtml).toContain('附着整段');
  });
});
