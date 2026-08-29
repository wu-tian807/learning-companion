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
    historyStore: {
      list: async () => [],
      save: async (record) => [record],
      remove: async () => [],
    },
  };
}

describe('WorkbenchConversationRuntime', () => {
  it('opens the active contribution and transports one typed launch request', () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('pdf.owner', contribution('pdf'));

    runtime.open({
      ownerId: 'pdf.owner',
      conversationId: 'conversation-1',
      context: { pageNumber: 2 },
      question: '解释这一段',
      submit: true,
    });

    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: true,
      active: { ownerId: 'pdf.owner' },
      launchRequest: {
        conversationId: 'conversation-1',
        context: { pageNumber: 2 },
        question: '解释这一段',
        submit: true,
      },
    });
    const requestId = runtime.getSnapshot().launchRequest!.id;
    runtime.consumeLaunchRequest(requestId);
    expect(runtime.getSnapshot().launchRequest).toBeUndefined();
  });

  it('toggles an available panel open and closed without cancelling its busy task', () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('epub.owner', contribution('epub'));

    runtime.toggle();
    runtime.setBusy('epub.owner', true);
    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: true,
      busy: true,
    });

    runtime.toggle();
    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: false,
      busy: true,
    });
  });

  it('does not leak an open panel, launch request or busy state across Workbenches', () => {
    const runtime = new WorkbenchConversationRuntime();
    const releasePdf = runtime.register('pdf.owner', contribution('pdf'));
    runtime.open({ ownerId: 'pdf.owner', question: 'old' });
    runtime.setBusy('pdf.owner', true);

    const releaseHtml = runtime.register('html.owner', contribution('html'));
    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: false,
      busy: false,
      active: { ownerId: 'html.owner' },
    });
    expect(runtime.getSnapshot().launchRequest).toBeUndefined();

    releasePdf();
    expect(runtime.getSnapshot().active?.ownerId).toBe('html.owner');
    releaseHtml();
    expect(runtime.getSnapshot()).toEqual({ panelOpen: false, busy: false });
  });

  it('treats two Assets using the same Workbench as separate owners', () => {
    const runtime = new WorkbenchConversationRuntime();
    runtime.register('pdf:session-a', contribution('pdf-a'));
    runtime.open({ ownerId: 'pdf:session-a', question: 'asset A' });
    runtime.setBusy('pdf:session-a', true);

    runtime.register('pdf:session-b', contribution('pdf-b'));

    expect(runtime.getSnapshot()).toMatchObject({
      panelOpen: false,
      busy: false,
      active: { ownerId: 'pdf:session-b' },
    });
    expect(runtime.getSnapshot().launchRequest).toBeUndefined();
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
