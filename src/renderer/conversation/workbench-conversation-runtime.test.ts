import { describe, expect, it } from 'vitest';

import type { WorkbenchConversationContribution } from './conversation-contracts';
import { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

function contribution(id: string): WorkbenchConversationContribution {
  return {
    id,
    workbenchId: 'test',
    contextProviderId: `${id}.context`,
    sourceAssetMode: 'reference',
  };
}

describe('WorkbenchConversationRuntime', () => {
  it('opens Project chat without any Workbench contribution', () => {
    const runtime = new WorkbenchConversationRuntime();

    runtime.open();

    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: true,
      busy: false,
      registryRevision: 0,
      launchRequest: {
        id: 1,
        clearContext: true,
      },
    });
    expect(runtime.getSnapshot().contextSource).toBeUndefined();
  });

  it('attaches a registered Workbench only as this launch context source', () => {
    const runtime = new WorkbenchConversationRuntime();
    const pdf = contribution('pdf');
    runtime.register('pdf.owner', 'asset-1', pdf);

    expect(runtime.getSnapshot().panelOpen).toBe(false);
    expect(runtime.getSnapshot().contextSource).toBeUndefined();

    runtime.open({
      ownerId: 'pdf.owner',
      conversationId: 'conversation-1',
      context: { pageNumber: 2 },
      question: '解释这一段',
      submit: true,
    });

    expect(runtime.getSnapshot()).toMatchObject({
      contextSource: {
        ownerId: 'pdf.owner',
        assetId: 'asset-1',
        contribution: pdf,
      },
      panelOpen: true,
      launchRequest: {
        id: 1,
        conversationId: 'conversation-1',
        context: { pageNumber: 2 },
        question: '解释这一段',
        submit: true,
      },
    });
  });

  it('preserves the open panel and busy state when the same context source updates', () => {
    const runtime = new WorkbenchConversationRuntime();
    const original = contribution('plain-text');
    const replacement = { ...original, title: 'updated' };
    const unregisterOriginal = runtime.register(
      'plain-text.owner',
      'asset-1',
      original,
    );
    runtime.open({
      ownerId: 'plain-text.owner',
      question: 'keep open',
    });
    runtime.setBusy(true);

    runtime.register(
      'plain-text.owner',
      'asset-1',
      replacement,
    );
    unregisterOriginal();

    return new Promise<void>((resolve) => {
      queueMicrotask(() => {
        expect(runtime.getSnapshot()).toMatchObject({
          contextSource: {
            ownerId: 'plain-text.owner',
            contribution: replacement,
          },
          panelOpen: true,
          busy: true,
        });
        resolve();
      });
    });
  });

  it('clears an unavailable context source without closing Project chat', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const release = runtime.register(
      'pdf.owner',
      'asset-1',
      contribution('pdf'),
    );
    runtime.open({
      ownerId: 'pdf.owner',
      context: { page: 1 },
    });

    release();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(runtime.getSnapshot().contextSource).toBeUndefined();
    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: true,
      launchRequest: {
        clearContext: true,
      },
    });
  });

  it('resolves optional context UI only for the matching mounted Asset', () => {
    const runtime = new WorkbenchConversationRuntime();
    const pdf = contribution('pdf');
    runtime.register('pdf.owner', 'asset-1', pdf);

    expect(runtime.resolveContribution({
      contributionId: 'pdf',
      contextProviderId: 'pdf.context',
      assetId: 'asset-1',
      sourceAssetMode: 'reference',
    })).toBe(pdf);
    expect(runtime.resolveContribution({
      contributionId: 'pdf',
      contextProviderId: 'pdf.context',
      assetId: 'asset-2',
      sourceAssetMode: 'reference',
    })).toBeUndefined();
  });

  it('rejects missing or unregistered Workbench context sources', () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('pdf.owner', 'asset-1', contribution('pdf'));

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
});
