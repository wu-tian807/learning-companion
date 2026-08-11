import { describe, expect, it } from 'vitest';

import { createAiChatStore } from './chat-store';

describe('Document AI chat session lifecycle', () => {
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
});
