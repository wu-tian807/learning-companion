import { describe, expect, it, vi } from 'vitest';

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

  it('does not leak an open panel, launch request or busy state across Workbenches', async () => {
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
    await Promise.resolve();
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

  it('notifies only the matching current-conversation scope', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = {
      projectId: 'project',
      assetId: 'asset',
      contributionId: 'video.frame-conversation',
      conversationPartitionKey: 'revision-1',
    };
    const matchingListener = vi.fn();
    const otherRevisionListener = vi.fn();
    runtime.subscribeCurrentConversation(scope, matchingListener);
    runtime.subscribeCurrentConversation(
      { ...scope, conversationPartitionKey: 'revision-2' },
      otherRevisionListener,
    );

    const selected = conversation('conversation-1');
    runtime.setCurrentConversation(scope, selected);
    runtime.setCurrentConversation(scope, selected);

    expect(matchingListener).toHaveBeenCalledOnce();
    expect(otherRevisionListener).not.toHaveBeenCalled();
  });

  it('isolates current conversations by the Workbench-owned partition key', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = {
      projectId: 'project',
      assetId: 'asset',
      contributionId: 'image.reading-conversation',
      conversationPartitionKey: 'revision-1',
    };
    const selected = conversation('conversation-old-revision');

    runtime.setCurrentConversation(scope, selected);

    expect(runtime.getCurrentConversation(scope)).toBe(selected);
    expect(runtime.getCurrentConversation({
      ...scope,
      conversationPartitionKey: 'revision-2',
    })).toBeUndefined();
  });

  it('resolves only the matching start operation and merges against the latest revision', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = {
      projectId: 'project',
      assetId: 'asset',
      contributionId: 'html.assistant',
    };
    const initial = conversation('conversation');
    runtime.setCurrentConversation(scope, initial);
    const optimistic: ConversationRecord = {
      ...initial,
      messages: [
        { id: 'question', role: 'user', text: 'question', createdTime: 2 },
        {
          id: 'answer',
          role: 'assistant',
          text: '',
          createdTime: 2,
          replyToMessageId: 'question',
        },
      ],
      updatedTime: 2,
    };
    const started = runtime.beginCurrentConversationStart(scope, {
      operationId: 'operation-1',
      expectedConversationId: initial.id,
      conversation: optimistic,
    })!;
    expect(started.pendingStart).toMatchObject({
      operationId: 'operation-1',
      startedRevision: started.revision,
      cancelRequested: false,
    });

    const newer: ConversationRecord = {
      ...optimistic,
      messages: [
        ...optimistic.messages,
        { id: 'newer', role: 'user', text: 'newer', createdTime: 3 },
      ],
      updatedTime: 3,
    };
    const newerState = runtime.setCurrentConversation(scope, newer);
    expect(newerState.revision).toBeGreaterThan(started.revision);
    expect(newerState.pendingStart?.operationId).toBe('operation-1');
    expect(runtime.resolveCurrentConversationStart(scope, {
      operationId: 'stale-operation',
      taskId: 'task-stale',
      assistantMessageId: 'answer',
      mode: 'answer',
      updateConversation: () => {
        throw new Error('stale updater must not run');
      },
    })).toBeUndefined();

    const resolved = runtime.resolveCurrentConversationStart(scope, {
      operationId: 'operation-1',
      taskId: 'task-1',
      assistantMessageId: 'answer',
      mode: 'answer',
      updateConversation: (current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === 'answer'
            ? { ...message, generationTaskId: 'task-1' }
            : message,
        ),
      }),
    })!;
    expect(resolved.state.conversation.messages).toHaveLength(3);
    expect(resolved.state.conversation.messages[1]?.generationTaskId)
      .toBe('task-1');
    expect(resolved.state.pendingStart).toBeUndefined();
    expect(resolved.state.activeTask).toEqual({
      taskId: 'task-1',
      conversationId: initial.id,
      assistantMessageId: 'answer',
      mode: 'answer',
    });
  });

  it('hands cancellation and start failure state across controller lifetimes', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = {
      projectId: 'project',
      assetId: 'asset',
      contributionId: 'html.assistant',
    };
    const initial = conversation('conversation');
    runtime.setCurrentConversation(scope, initial);
    runtime.beginCurrentConversationStart(scope, {
      operationId: 'operation-cancel',
      expectedConversationId: initial.id,
      conversation: initial,
    });
    const cancelled = runtime.requestCurrentConversationStartCancel(
      scope,
      'operation-cancel',
    );
    expect(cancelled?.pendingStart?.cancelRequested).toBe(true);
    const resolved = runtime.resolveCurrentConversationStart(scope, {
      operationId: 'operation-cancel',
      taskId: 'task-cancel',
      assistantMessageId: 'answer-cancel',
      mode: 'answer',
      updateConversation: (current) => ({
        ...current,
        messages: [{
          id: 'answer-cancel',
          role: 'assistant',
          text: '',
          createdTime: 2,
          generationTaskId: 'task-cancel',
        }],
      }),
    });
    expect(resolved?.cancelRequested).toBe(true);
    expect(runtime.finishCurrentConversationTask(scope, 'task-stale'))
      .toBeUndefined();
    expect(runtime.finishCurrentConversationTask(scope, 'task-cancel')?.activeTask)
      .toBeUndefined();

    runtime.beginCurrentConversationStart(scope, {
      operationId: 'operation-failure',
      expectedConversationId: initial.id,
      conversation: initial,
    });
    const context = { target: { scope: 'selection' } };
    const rejected = runtime.rejectCurrentConversationStart(scope, {
      operationId: 'operation-failure',
      draft: 'restore me',
      pendingContext: context,
      error: { message: 'failed', code: 'START_FAILED' },
      rollbackConversation: (current) => current,
    });
    expect(rejected).toMatchObject({
      conversation: initial,
      startFailure: {
        operationId: 'operation-failure',
        draft: 'restore me',
        pendingContext: context,
        error: { message: 'failed', code: 'START_FAILED' },
      },
    });
  });

  it('recovers one active task per Conversation and clears only its matching terminal', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = {
      projectId: 'project',
      assetId: 'asset',
      contributionId: 'html.assistant',
    };
    const selected: ConversationRecord = {
      ...conversation('conversation-active'),
      messages: [{
        id: 'answer-active',
        role: 'assistant',
        text: 'partial',
        createdTime: 2,
        generationTaskId: 'task-active',
      }],
    };
    runtime.setCurrentConversation(scope, selected);

    const recovered = runtime.recoverCurrentConversationTask(scope, {
      expectedConversationId: selected.id,
      taskId: 'task-active',
      assistantMessageId: 'answer-active',
      mode: 'answer',
    });
    expect(recovered?.activeTask).toEqual({
      taskId: 'task-active',
      conversationId: selected.id,
      assistantMessageId: 'answer-active',
      mode: 'answer',
    });
    expect(runtime.beginCurrentConversationStart(scope, {
      operationId: 'must-stay-blocked',
      expectedConversationId: selected.id,
      conversation: selected,
    })).toBeUndefined();

    const streamed: ConversationRecord = {
      ...selected,
      messages: [{ ...selected.messages[0]!, text: 'partial answer' }],
      updatedTime: 3,
    };
    expect(runtime.setCurrentConversation(scope, streamed).activeTask?.taskId)
      .toBe('task-active');
    expect(runtime.finishCurrentConversationTask(scope, 'task-other'))
      .toBeUndefined();
    expect(runtime.getCurrentConversationState(scope)?.activeTask?.taskId)
      .toBe('task-active');
    expect(runtime.finishCurrentConversationTask(scope, 'task-active')?.activeTask)
      .toBeUndefined();
  });

  it('does not carry an active task across Conversation pointers', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = {
      projectId: 'project',
      assetId: 'asset',
      contributionId: 'html.assistant',
    };
    const selected: ConversationRecord = {
      ...conversation('conversation-active'),
      messages: [{
        id: 'answer-active',
        role: 'assistant',
        text: '',
        createdTime: 2,
        generationTaskId: 'task-active',
      }],
    };
    runtime.setCurrentConversation(scope, selected);
    runtime.recoverCurrentConversationTask(scope, {
      expectedConversationId: selected.id,
      taskId: 'task-active',
      assistantMessageId: 'answer-active',
      mode: 'answer',
    });

    const switched = conversation('conversation-new');
    expect(runtime.setCurrentConversation(scope, switched).activeTask)
      .toBeUndefined();
    expect(runtime.finishCurrentConversationTask(scope, 'task-active'))
      .toBeUndefined();
    expect(runtime.getCurrentConversation(scope)).toBe(switched);
  });

  it('invalidates a pending start when the current conversation pointer changes', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = {
      projectId: 'project',
      assetId: 'asset',
      contributionId: 'html.assistant',
    };
    const initial = conversation('conversation-1');
    runtime.setCurrentConversation(scope, initial);
    runtime.beginCurrentConversationStart(scope, {
      operationId: 'operation-old',
      expectedConversationId: initial.id,
      conversation: initial,
    });
    const switched = conversation('conversation-2');
    const switchedState = runtime.setCurrentConversation(scope, switched);

    expect(switchedState.pendingStart).toBeUndefined();
    expect(runtime.resolveCurrentConversationStart(scope, {
      operationId: 'operation-old',
      taskId: 'task-late',
      assistantMessageId: 'answer-old',
      mode: 'answer',
      updateConversation: () => initial,
    })).toBeUndefined();
    expect(runtime.getCurrentConversation(scope)).toBe(switched);
  });

  it('abandons a matching operation when its merge target no longer exists', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = {
      projectId: 'project',
      assetId: 'asset',
      contributionId: 'html.assistant',
    };
    const initial = conversation('conversation');
    runtime.setCurrentConversation(scope, initial);
    runtime.beginCurrentConversationStart(scope, {
      operationId: 'operation-without-target',
      expectedConversationId: initial.id,
      conversation: initial,
    });

    expect(runtime.resolveCurrentConversationStart(scope, {
      operationId: 'operation-without-target',
      taskId: 'task-late',
      assistantMessageId: 'answer-missing',
      mode: 'answer',
      updateConversation: () => undefined,
    })).toBeUndefined();
    expect(runtime.getCurrentConversationState(scope)?.pendingStart)
      .toBeUndefined();
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
    expect(() => runtime.getCurrentConversation({
      ...scope,
      conversationPartitionKey: ' ',
    })).toThrow('Workbench Conversation scope 无效');
    expect(() => runtime.setCurrentConversation(scope, conversation(' ')))
      .toThrow('Workbench Conversation identity 无效');
  });
});
