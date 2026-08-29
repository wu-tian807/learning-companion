import { describe, expect, it } from 'vitest';

import type {
  ConversationRecord,
  WorkbenchConversationContribution,
} from './conversation-contracts';
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

function conversation(id: string): ConversationRecord {
  return {
    id,
    title: id,
    messages: [],
    createdTime: 1,
    updatedTime: 1,
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

  it('keeps the current UI conversation isolated by Project, Asset and contribution', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = {
      projectId: 'project-a',
      assetId: 'asset-a',
      contributionId: 'html.assistant',
    };
    const selected = conversation('conversation-a');

    runtime.setCurrentConversation(scope, selected);

    expect(runtime.getCurrentConversation(scope)).toBe(selected);
    const replacement = conversation('conversation-b');
    runtime.setCurrentConversation(scope, replacement);
    expect(runtime.getCurrentConversation(scope)).toBe(replacement);
    expect(runtime.getCurrentConversation({ ...scope, projectId: 'project-b' }))
      .toBeUndefined();
    expect(runtime.getCurrentConversation({ ...scope, assetId: 'asset-b' }))
      .toBeUndefined();
    expect(runtime.getCurrentConversation({
      ...scope,
      contributionId: 'pdf.document-question',
    })).toBeUndefined();
  });

  it('drops only the in-memory current conversation state on disposal', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = {
      projectId: 'project',
      assetId: 'asset',
      contributionId: 'html.assistant',
    };
    runtime.setCurrentConversation(scope, conversation('conversation'));

    runtime.dispose();

    expect(runtime.getCurrentConversation(scope)).toBeUndefined();
  });

  it('rejects invalid current conversation scopes and identities', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = {
      projectId: 'project',
      assetId: 'asset',
      contributionId: 'html.assistant',
    };

    expect(() => runtime.getCurrentConversation({ ...scope, assetId: ' ' }))
      .toThrow('Workbench Conversation scope 无效');
    expect(() => runtime.setCurrentConversation(scope, conversation(' ')))
      .toThrow('Workbench Conversation identity 无效');
  });
});
