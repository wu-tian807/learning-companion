import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerWorkbenchTargetController,
  resetWorkbenchTargetControllerForTests,
} from '../workbench/host/workbench-target-bridge';
import type {
  ConversationMessageContextSource,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

const target = {
  scope: 'content' as const,
  targetType: 'test.anchor',
  targetVersion: 1,
  targetPayload: { exact: '旧记录里的原文' },
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

afterEach(resetWorkbenchTargetControllerForTests);

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

  it('waits for the ConversationSession to settle an explicit open request', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const pending = runtime.openAndWait();
    const requestId = runtime.getSnapshot().launchRequest?.id;

    expect(requestId).toBe(1);
    let resolved = false;
    void pending.then(
      () => {
        resolved = true;
      },
      () => undefined,
    );
    await Promise.resolve();
    expect(resolved).toBe(false);

    runtime.settleLaunchRequest(requestId!, new Error('打开失败'));
    await expect(pending).rejects.toThrow('打开失败');
  });

  it('rejects an old open waiter when a newer launch supersedes it', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const first = runtime.openAndWait();

    runtime.open();

    await expect(first).rejects.toThrow('新的请求替换');
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

  it('injects node context without changing the current mode or bound Asset', () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('outline.owner', 'outline-1', contribution('outline'));
    runtime.open({
      ownerId: 'outline.owner',
      modeId: 'learning-outline.intake',
      boundAssetId: 'outline-1',
      conversationId: 'conversation-1',
    });

    runtime.open({
      ownerId: 'outline.owner',
      context: { target },
      question: '请把这个节点纳入学习需求。',
      submit: true,
    });

    expect(runtime.getSnapshot()).toMatchObject({
      modeId: 'learning-outline.intake',
      boundAssetId: 'outline-1',
      conversationId: 'conversation-1',
      launchRequest: {
        modeId: 'learning-outline.intake',
        boundAssetId: 'outline-1',
        conversationId: 'conversation-1',
        context: { target },
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

  it('keeps a second Workbench contribution resolvable after another viewport unmounts', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const first = contribution('pdf');
    const second = contribution('image');
    const removeFirst = runtime.register('material.viewport', 'asset-pdf', first);
    runtime.register('notebook.viewport', 'asset-image', second);

    removeFirst();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(runtime.resolveContribution(source('image', 'asset-image'))).toBe(second);
    expect(runtime.resolveContribution(source('pdf', 'asset-pdf'))).toBeUndefined();
  });

  it('does not cancel a material launch when the unrelated last-mounted notebook closes', async () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('material.viewport', 'pdf', contribution('pdf'));
    const closeNotebook = runtime.register(
      'notebook.viewport',
      'note',
      contribution('markdown'),
    );
    const pending = runtime.openAndWait({
      ownerId: 'material.viewport',
      context: { captured: 'source selection' },
    });
    const request = runtime.getSnapshot().launchRequest!;

    closeNotebook();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    runtime.settleLaunchRequest(request.id);

    await expect(pending).resolves.toBeUndefined();
    expect(runtime.getSnapshot().launchRequest).toBe(request);
    expect(runtime.getSnapshot().launchRequest?.contextSource?.assetId).toBe('pdf');
  });

  it('retains a consumed request owner without letting notebook replacement clear it', async () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('material.viewport', 'pdf', contribution('pdf'));
    const closeNotebook = runtime.register(
      'notebook.viewport',
      'note',
      contribution('markdown'),
    );
    runtime.open({
      ownerId: 'material.viewport',
      context: { captured: 'immutable source' },
    });
    const request = runtime.getSnapshot().launchRequest!;
    runtime.consumeLaunchRequest(request.id);
    closeNotebook();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    runtime.register('notebook.viewport', 'new-note', contribution('markdown'));

    expect(runtime.getSnapshot().launchRequest).toBeUndefined();
    expect(runtime.resolveContribution(source('pdf', 'pdf'))).toBeDefined();
  });

  it('clears only transient context when its Workbench unmounts', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const unregister = runtime.register(
      'owner',
      'asset-1',
      contribution('pdf'),
    );
    runtime.open({ ownerId: 'owner', context: { target } });
    unregister();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: true,
      launchRequest: { clearContext: true },
    });
    expect(runtime.getSnapshot().active).toBeUndefined();
  });

  it('selects the referenced Asset and waits for its Target controller', async () => {
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
    registerWorkbenchTargetController('html.owner', 'asset-html', { reveal });
    await pending;
    expect(reveal).toHaveBeenCalledWith(target);
  });

  it('reveals an Asset-scoped Target by selecting it without waiting for a content controller', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const selectAsset = vi.fn();

    await expect(
      runtime.revealContext(
        source('unsupported', 'asset-whole'),
        { target: { scope: 'asset' } },
        selectAsset,
        1,
      ),
    ).resolves.toBeUndefined();

    expect(selectAsset).toHaveBeenCalledWith('asset-whole');
  });

  it('rejects deleted Assets and invalid Targets without guessing', async () => {
    const runtime = new WorkbenchConversationRuntime();
    await expect(
      runtime.revealContext(source('html', 'deleted'), { target }, () => {
        throw new Error('引用的资料已不存在，无法定位原文。');
      }),
    ).rejects.toThrow('引用的资料已不存在');
    await expect(
      runtime.revealContext(
        source('html', 'asset-html'),
        { opaque: true },
        vi.fn(),
      ),
    ).rejects.toThrow('没有有效 Target');
    expect(() => runtime.open({ ownerId: 'missing' })).toThrow(
      '当前 Workbench 没有注册 AI 问答上下文',
    );
  });

  it('rejects a stale content revision through the shared Target controller', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const reveal = vi.fn(() => true);
    registerWorkbenchTargetController('image.owner', 'asset-image', {
      sourceRevision: 'new',
      reveal,
    });

    await expect(
      runtime.revealContext(
        source('image', 'asset-image'),
        { sourceRevision: 'old', target },
        vi.fn(),
      ),
    ).rejects.toThrow('资料内容已更新');
    expect(reveal).not.toHaveBeenCalled();
  });
});
