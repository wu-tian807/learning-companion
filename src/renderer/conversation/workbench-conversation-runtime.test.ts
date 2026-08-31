import { describe, expect, it } from 'vitest';

import type { WorkbenchConversationContribution } from './conversation-contracts';
import { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

function contribution(id: string): WorkbenchConversationContribution {
  return {
    id,
    workbenchId: `${id}.workbench`,
    contextProviderId: `${id}.context`,
    title: id,
    emptyLabel: 'empty',
  };
}

describe('WorkbenchConversationRuntime', () => {
  it('opens the active contribution and transports one typed launch request', () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('pdf.owner', contribution('pdf'));

    runtime.open({
      ownerId: 'pdf.owner',
      conversationId: 'conversation-1',
      fallbackToNewConversation: true,
      context: { pageNumber: 2 },
      question: '解释这一段',
      submit: true,
    });

    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: true,
      active: { ownerId: 'pdf.owner' },
      launchRequest: {
        conversationId: 'conversation-1',
        fallbackToNewConversation: true,
        context: { pageNumber: 2 },
        question: '解释这一段',
        submit: true,
      },
    });
    const requestId = runtime.getSnapshot().launchRequest!.id;
    runtime.consumeLaunchRequest(requestId);
    expect(runtime.getSnapshot().launchRequest).toBeUndefined();
  });

  it('does not let a newly registered Workbench steal the active Project chat', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const releasePdf = runtime.register('pdf.owner', contribution('pdf'));
    runtime.open({ ownerId: 'pdf.owner', question: 'old' });
    runtime.setBusy('pdf.owner', true);

    const releaseHtml = runtime.register('html.owner', contribution('html'));
    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: true,
      busy: true,
      active: { ownerId: 'pdf.owner' },
    });
    expect(runtime.getSnapshot().launchRequest?.question).toBe('old');

    releasePdf();
    await Promise.resolve();
    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: false,
      busy: false,
      active: { ownerId: 'html.owner' },
    });
    expect(runtime.getSnapshot().launchRequest).toBeUndefined();
    releaseHtml();
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.getSnapshot()).toEqual({ panelOpen: false, busy: false });
  });

  it('treats two Assets as separate owners without changing the open owner', () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('pdf:session-a', contribution('pdf-a'));
    runtime.open({ ownerId: 'pdf:session-a', question: 'asset A' });
    runtime.setBusy('pdf:session-a', true);

    runtime.register('pdf:session-b', contribution('pdf-b'));

    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: true,
      busy: true,
      active: { ownerId: 'pdf:session-a' },
    });
    expect(runtime.getSnapshot().launchRequest?.question).toBe('asset A');
  });

  it('replaces one owner contribution without closing its open panel', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const initial = contribution('plain-text.initial');
    const updated = contribution('plain-text.updated');
    const releaseInitial = runtime.register('plain-text.owner', initial);
    runtime.open({ ownerId: 'plain-text.owner', question: 'keep open' });
    runtime.setBusy('plain-text.owner', true);
    const launchRequest = runtime.getSnapshot().launchRequest;

    releaseInitial();
    runtime.register('plain-text.owner', updated);
    await Promise.resolve();

    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: true,
      busy: true,
      active: {
        ownerId: 'plain-text.owner',
        contribution: updated,
      },
    });
    expect(runtime.getSnapshot().launchRequest).toBe(launchRequest);
  });

  it('ignores stale busy reports and rejects opening an unregistered owner', () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('active', contribution('active'));
    runtime.setBusy('stale', true);
    expect(runtime.getSnapshot().busy).toBe(false);
    expect(() => runtime.open({ ownerId: 'missing' })).toThrow(
      '当前 Workbench 没有注册 AI 问答能力',
    );
  });
});
