import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerWorkbenchAnchorController,
  resetWorkbenchAnchorControllerForTests,
} from '../workbench/host/workbench-anchor-bridge';
import type {
  ConversationMessageContextSource,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

const target = {
  scope: 'content' as const,
  anchorType: 'test.anchor',
  anchorVersion: 1,
  anchorPayload: { exact: '旧记录里的原文' },
};

function contribution(id: string): WorkbenchConversationContribution {
  return {
    contextProviderId: `${id}.context`,
    sourceAssetMode: 'reference',
  };
}

function source(id: string, assetId: string): ConversationMessageContextSource {
  return {
    contextProviderId: `${id}.context`,
    assetId,
    sourceAssetMode: 'reference',
  };
}

afterEach(resetWorkbenchAnchorControllerForTests);

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

  it('attaches only an explicitly named active Workbench to a launch', () => {
    const runtime = new WorkbenchConversationRuntime();
    const pdf = contribution('pdf');
    runtime.register('pdf.owner', 'asset-1', pdf);
    runtime.open({
      ownerId: 'pdf.owner',
      conversationId: 'conversation-1',
      context: { target },
      question: '解释这一段',
      submit: true,
    });

    expect(runtime.getSnapshot()).toMatchObject({
      active: { assetId: 'asset-1', contribution: pdf },
      launchRequest: {
        conversationId: 'conversation-1',
        contextSource: { assetId: 'asset-1', contribution: pdf },
        context: { target },
        question: '解释这一段',
        submit: true,
      },
    });
  });

  it('does not let stale cleanup replace an active registration', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const original = contribution('plain-text');
    const replacement = contribution('plain-text');
    const unregister = runtime.register('owner', 'asset-1', original);
    runtime.open({ ownerId: 'owner' });
    runtime.register('owner', 'asset-1', replacement);
    unregister();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(runtime.getSnapshot()).toMatchObject({
      active: { contribution: replacement },
      panelOpen: true,
    });
  });

  it('clears only transient context when its Workbench unmounts', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const unregister = runtime.register('owner', 'asset-1', contribution('pdf'));
    runtime.open({ ownerId: 'owner', context: { target } });
    unregister();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: true,
      launchRequest: { clearContext: true },
    });
    expect(runtime.getSnapshot().active).toBeUndefined();
  });

  it('selects the referenced Asset and waits for its anchor controller', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const reveal = vi.fn(() => true);
    const selectAsset = vi.fn();
    const pending = runtime.revealContext(
      source('html', 'asset-html'),
      { target },
      selectAsset,
    );

    expect(selectAsset).toHaveBeenCalledWith('asset-html');
    expect(reveal).not.toHaveBeenCalled();
    registerWorkbenchAnchorController('html.owner', 'asset-html', { reveal });
    await pending;
    expect(reveal).toHaveBeenCalledWith(target);
  });

  it('rejects deleted Assets and invalid anchors without guessing', async () => {
    const runtime = new WorkbenchConversationRuntime();
    await expect(runtime.revealContext(
      source('html', 'deleted'),
      { target },
      () => { throw new Error('引用的资料已不存在，无法定位原文。'); },
    )).rejects.toThrow('引用的资料已不存在');
    await expect(runtime.revealContext(
      source('html', 'asset-html'),
      { opaque: true },
      vi.fn(),
    )).rejects.toThrow('没有有效 Anchor');
    expect(() => runtime.open({ ownerId: 'missing' })).toThrow(
      '当前 Workbench 没有注册 AI 问答上下文',
    );
  });

  it('rejects a stale content revision through the shared anchor controller', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const reveal = vi.fn(() => true);
    registerWorkbenchAnchorController('image.owner', 'asset-image', {
      sourceRevision: 'new',
      reveal,
    });

    await expect(runtime.revealContext(
      source('image', 'asset-image'),
      { sourceRevision: 'old', target },
      vi.fn(),
    )).rejects.toThrow('资料内容已更新');
    expect(reveal).not.toHaveBeenCalled();
  });
});
