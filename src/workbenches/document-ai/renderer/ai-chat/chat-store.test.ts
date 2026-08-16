import { describe, expect, it } from 'vitest';

import {
  createAiChatStore,
  createLegacyConversationTitle,
  type AiChatHistoryStorage,
} from './chat-store';

function createHistoryStorage(): AiChatHistoryStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}

describe('Document AI chat session lifecycle', () => {
  it('turns legacy raw questions into concise local titles without another model request', () => {
    expect(createLegacyConversationTitle('Question: 为什么这个方法更好 Document path: file.pdf'))
      .toBe('这个方法的优势');
    expect(createLegacyConversationTitle('请用通俗易懂的语言解释我框选的内容'))
      .toBe('框选内容通俗解释');
    expect(createLegacyConversationTitle('怎么算的？')).toBe('计算过程');
    expect(createLegacyConversationTitle('详细点过程')).toBe('详细推导过程');
  });

  it('isolates assets and rotates provider conversation identity when cleared', () => {
    let sequence = 0;
    const store = createAiChatStore(() => `conversation-${++sequence}`);
    const first = store.ensureSession('project', 'asset-a');
    const second = store.ensureSession('project', 'asset-b');

    expect(first.id).not.toBe(second.id);
    store.addUserMessage('asset-a', 'question');
    expect(store.getSession('asset-b')?.messages).toHaveLength(0);

    store.clearSession('asset-a');
    const cleared = store.getSession('asset-a')!;
    expect(cleared.id).not.toBe(first.id);
    expect(cleared.messages).toHaveLength(0);
    expect(cleared.projectId).toBe('project');
  });

  it('keeps late replies attached to their asset only', () => {
    let sequence = 0;
    const store = createAiChatStore(() => `conversation-${++sequence}`);
    store.ensureSession('project', 'asset-a');
    store.ensureSession('project', 'asset-b');
    const a = store.addUserMessage('asset-a', 'a').messages.at(-1)!;
    const b = store.addUserMessage('asset-b', 'b').messages.at(-1)!;

    store.addAssistantMessage('asset-b', 'reply-b', b.id);
    store.addAssistantMessage('asset-a', 'reply-a', a.id);

    expect(store.getSession('asset-a')?.messages.map(({ content }) => content))
      .toEqual(['a', 'reply-a']);
    expect(store.getSession('asset-b')?.messages.map(({ content }) => content))
      .toEqual(['b', 'reply-b']);
  });

  it('discards a reply that completes after its conversation was cleared', () => {
    let sequence = 0;
    const store = createAiChatStore(() => `conversation-${++sequence}`);
    store.ensureSession('project', 'asset');
    const pending = store.addUserMessage('asset', 'question').messages.at(-1)!;

    store.clearSession('asset');
    store.addAssistantMessage('asset', 'stale reply', pending.id);

    expect(store.getSession('asset')?.messages).toHaveLength(0);
  });

  it('clears the visible error when a retry starts and succeeds', () => {
    const store = createAiChatStore(() => 'conversation');
    store.ensureSession('project', 'asset');
    store.setError('asset', '模型未配置');
    const question = store.addUserMessage('asset', 'retry').messages.at(-1)!;
    expect(store.getSession('asset')?.error).toBeUndefined();
    store.addAssistantMessage('asset', 'ok', question.id);
    expect(store.getSession('asset')?.error).toBeUndefined();
  });

  it('starts a new provider conversation after a renderer restart', () => {
    const beforeRestart = createAiChatStore(() => 'conversation-before-restart');
    const afterRestart = createAiChatStore(() => 'conversation-after-restart');

    expect(beforeRestart.ensureSession('project', 'asset').id)
      .toBe('conversation-before-restart');
    expect(afterRestart.ensureSession('project', 'asset').id)
      .toBe('conversation-after-restart');
    expect(afterRestart.getSession('asset')?.messages).toHaveLength(0);
  });

  it('restores local question and answer history without reusing the provider conversation', () => {
    const storage = createHistoryStorage();
    const firstStore = createAiChatStore(() => 'first-conversation', storage);
    const firstSession = firstStore.ensureSession('project', 'asset');
    const question = firstStore.addUserMessage('asset', '旧问题').messages.at(-1)!;
    firstStore.addAssistantMessage('asset', '旧回答', question.id, 'provider/model');

    const restartedStore = createAiChatStore(() => 'new-conversation', storage);
    const restartedSession = restartedStore.ensureSession('project', 'asset');
    expect(restartedSession.id).not.toBe(firstSession.id);
    expect(restartedSession.messages.map(({ content }) => content))
      .toEqual(['旧问题', '旧回答']);

    restartedStore.clearSession('asset');
    const afterClear = createAiChatStore(() => 'after-clear', storage)
      .ensureSession('project', 'asset');
    expect(afterClear.messages).toHaveLength(0);
  });

  it('restores the source anchor with local question history', () => {
    const storage = createHistoryStorage();
    const firstStore = createAiChatStore(() => 'first', storage);
    firstStore.ensureSession('project', 'asset');
    firstStore.addUserMessage('asset', '解释这个公式', {
      target: {
        scope: 'content',
        anchorType: 'pdf.region',
        anchorVersion: 1,
        anchorPayload: {
          pageNumber: 4,
          x: 0.2,
          y: 0.3,
          width: 0.4,
          height: 0.2,
        },
      },
      pageNumber: 4,
      selectedText: 'softmax 注意力权重',
      previewDataUrl: 'data:image/jpeg;base64,cHJldmlldw==',
    });

    const restored = createAiChatStore(() => 'second', storage)
      .ensureSession('project', 'asset');
    const question = restored.messages.at(0);

    expect(question?.anchor?.pageNumber).toBe(4);
    expect(question?.anchor?.selectedText).toBe('softmax 注意力权重');
    expect(question?.anchor?.previewDataUrl).toBe(
      'data:image/jpeg;base64,cHJldmlldw==',
    );
    expect(question?.anchor?.target).toMatchObject({
      scope: 'content',
      anchorType: 'pdf.region',
    });
  });

  it('backfills and persists a preview for an existing anchored question', () => {
    const storage = createHistoryStorage();
    const store = createAiChatStore(() => 'conversation', storage);
    store.ensureSession('project', 'asset');
    const question = store.addUserMessage('asset', '旧问题', {
      target: {
        scope: 'content',
        anchorType: 'pdf.region',
        anchorVersion: 1,
        anchorPayload: { pageNumber: 6, x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      },
      pageNumber: 6,
    }).messages.at(-1)!;

    store.setMessageAnchorPreview(
      'asset',
      question.id,
      'data:image/jpeg;base64,cHJldmlldw==',
    );

    const restored = createAiChatStore(() => 'restored', storage)
      .ensureSession('project', 'asset');
    expect(restored.messages.at(0)?.anchor?.previewDataUrl).toBe(
      'data:image/jpeg;base64,cHJldmlldw==',
    );
  });

  it('creates an independent conversation for each selected region and resumes the chosen one', () => {
    let sequence = 0;
    const store = createAiChatStore(() => `id-${++sequence}`);
    store.ensureSession('project', 'asset');
    const anchor = (pageNumber: number) => ({
      target: {
        scope: 'content' as const,
        anchorType: 'pdf.region',
        anchorVersion: 1,
        anchorPayload: { pageNumber, x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      },
      pageNumber,
    });
    const first = store.addUserMessage('asset', '第一个区域', anchor(1))
      .messages.at(-1)!;
    const second = store.addUserMessage('asset', '第二个区域', anchor(2))
      .messages.at(-1)!;

    expect(first.conversationId).not.toBe(second.conversationId);
    expect(store.getConversations('asset').map(({ title }) => title))
      .toEqual(['第二个区域', '第一个区域']);

    store.selectConversation('asset', first.conversationId!);
    const followUp = store.addUserMessage('asset', '继续追问').messages.at(-1)!;
    expect(followUp.conversationId).toBe(first.conversationId);

    store.clearSession('asset');
    expect(store.getConversations('asset').map(({ title }) => title))
      .toEqual(['第二个区域']);
  });

  it('uses and persists the AI-generated summary as the conversation title', () => {
    let sequence = 0;
    const storage = createHistoryStorage();
    const store = createAiChatStore(() => `id-${++sequence}`, storage);
    store.ensureSession('project', 'asset');
    const question = store.addUserMessage('asset', '为什么这个方法更好').messages.at(-1)!;
    store.addAssistantMessage(
      'asset',
      '因为它降低了计算复杂度。',
      question.id,
      'provider/model',
      '高效注意力计算',
    );

    expect(store.getConversations('asset').at(0)?.title).toBe('高效注意力计算');
    const restored = createAiChatStore(() => 'restored', storage);
    restored.ensureSession('project', 'asset');
    expect(restored.getConversations('asset').at(0)?.title).toBe('高效注意力计算');
  });
});
