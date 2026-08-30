import { describe, expect, it, vi } from 'vitest';

import type {
  ConversationMessageContextSource,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

function contribution(
  id: string,
  revealContext?: WorkbenchConversationContribution['revealContext'],
): WorkbenchConversationContribution {
  return {
    id,
    workbenchId: 'test',
    contextProviderId: `${id}.context`,
    sourceAssetMode: 'reference',
    revealContext,
  };
}

function source(
  id: string,
  assetId: string,
): ConversationMessageContextSource {
  return {
    contributionId: id,
    contextProviderId: `${id}.context`,
    assetId,
    sourceAssetMode: 'reference',
  };
}

describe('WorkbenchConversationRuntime', () => {
  it('keeps Project chat available without a Workbench', () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.open();

    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: true,
      busy: false,
      launchRequest: { id: 1, clearContext: true },
    });
    expect(runtime.getSnapshot().active).toBeUndefined();
  });

  it('describes persisted context without mounting its Workbench', () => {
    const describe = vi.fn(() => ({
      label: '选中文本',
      detail: '旧记录里的原文',
    }));
    const runtime = new WorkbenchConversationRuntime(describe);
    const persistedSource = source('html', 'asset-html');

    expect(runtime.describeContext(persistedSource, { anchor: 'target' })).toEqual({
      label: '选中文本',
      detail: '旧记录里的原文',
    });
    expect(describe).toHaveBeenCalledWith(
      persistedSource,
      { anchor: 'target' },
    );
    expect(runtime.getSnapshot().active).toBeUndefined();
  });

  it('attaches only an explicitly named active Workbench to a launch', () => {
    const runtime = new WorkbenchConversationRuntime();
    const pdf = contribution('pdf');
    runtime.register('pdf.owner', 'asset-1', pdf);
    runtime.open({
      ownerId: 'pdf.owner',
      conversationId: 'conversation-1',
      context: { pageNumber: 2 },
      question: '解释这一段',
      submit: true,
    });

    expect(runtime.getSnapshot()).toMatchObject({
      active: { assetId: 'asset-1', contribution: pdf },
      panelOpen: true,
      launchRequest: {
        conversationId: 'conversation-1',
        contextSource: { assetId: 'asset-1', contribution: pdf },
        context: { pageNumber: 2 },
        question: '解释这一段',
        submit: true,
      },
    });
  });

  it('replaces the active instance without letting stale cleanup close chat', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const original = contribution('plain-text');
    const replacement = contribution('plain-text');
    const unregisterOriginal = runtime.register(
      'plain-text.owner',
      'asset-1',
      original,
    );
    runtime.open({ ownerId: 'plain-text.owner', question: 'keep open' });
    runtime.setBusy(true);
    runtime.register('plain-text.owner', 'asset-1', replacement);
    unregisterOriginal();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(runtime.getSnapshot()).toMatchObject({
      active: { contribution: replacement },
      panelOpen: true,
      busy: true,
    });
  });

  it('clears only transient context when its Workbench unmounts', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const unregister = runtime.register(
      'pdf.owner',
      'asset-1',
      contribution('pdf'),
    );
    runtime.open({ ownerId: 'pdf.owner', context: { page: 1 } });
    unregister();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: true,
      launchRequest: { clearContext: true },
    });
    expect(runtime.getSnapshot().active).toBeUndefined();
  });

  it('selects a referenced Asset and waits for its Workbench before reveal', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const reveal = vi.fn();
    const selectAsset = vi.fn();
    const pending = runtime.revealContext(
      source('html', 'asset-html'),
      { anchor: 'target' },
      selectAsset,
    );

    expect(selectAsset).toHaveBeenCalledWith('asset-html');
    expect(reveal).not.toHaveBeenCalled();
    runtime.register(
      'html.owner',
      'asset-html',
      contribution('html', reveal),
    );
    await pending;
    expect(reveal).toHaveBeenCalledWith({ anchor: 'target' });
  });

  it('rejects deleted Assets and invalid registrations without guessing', async () => {
    const runtime = new WorkbenchConversationRuntime();
    await expect(
      runtime.revealContext(
        source('html', 'deleted'),
        { anchor: 'target' },
        () => {
          throw new Error('引用的资料已不存在，无法定位原文。');
        },
      ),
    ).rejects.toThrow('引用的资料已不存在');
    expect(() => runtime.open({ ownerId: 'missing' })).toThrow(
      '当前 Workbench 没有注册 AI 问答上下文',
    );
    expect(() => runtime.open({ context: { page: 1 } })).toThrow(
      'AI 问答上下文没有已注册的来源',
    );
    expect(() =>
      runtime.register('invalid', '', contribution('pdf')),
    ).toThrow('Workbench Conversation context contribution 无效');
  });

  it('rejects stale context after the target Workbench is ready', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const staleContribution = {
      ...contribution('image', vi.fn()),
      isContext: vi.fn(() => false),
    };
    runtime.register('image.owner', 'asset-image', staleContribution);

    await expect(runtime.revealContext(
      source('image', 'asset-image'),
      { sourceRevision: 'old' },
      vi.fn(),
    )).rejects.toThrow('资料内容已更新');
    expect(staleContribution.revealContext).not.toHaveBeenCalled();
  });
});
