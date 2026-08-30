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

  it('keeps one current UI conversation per Project across Workbench changes', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = { projectId: 'project-a' };
    const selected = conversation('conversation-a');

    runtime.setCurrentConversation(scope, selected);

    expect(runtime.getCurrentConversation(scope)).toBe(selected);
    const replacement = conversation('conversation-b');
    runtime.setCurrentConversation(scope, replacement);
    expect(runtime.getCurrentConversation(scope)).toBe(replacement);
    expect(runtime.getCurrentConversation({ ...scope, projectId: 'project-b' }))
      .toBeUndefined();
  });

  it('notifies only the matching Project conversation scope', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = { projectId: 'project' };
    const matchingListener = vi.fn();
    const otherProjectListener = vi.fn();
    runtime.subscribeCurrentConversation(scope, matchingListener);
    runtime.subscribeCurrentConversation(
      { projectId: 'other-project' },
      otherProjectListener,
    );

    const selected = conversation('conversation-1');
    runtime.setCurrentConversation(scope, selected);
    runtime.setCurrentConversation(scope, selected);

    expect(matchingListener).toHaveBeenCalledOnce();
    expect(otherProjectListener).not.toHaveBeenCalled();
  });

  it('serializes history mutations per scope without blocking another scope', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = { projectId: 'project' };
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];

    const first = runtime.enqueueCurrentConversationHistoryMutation(
      scope,
      async () => {
        calls.push('first:start');
        await firstGate;
        calls.push('first:end');
        return 'first';
      },
    );
    const second = runtime.enqueueCurrentConversationHistoryMutation(
      scope,
      async () => {
        calls.push('second');
        return 'second';
      },
    );
    const otherScope = runtime.enqueueCurrentConversationHistoryMutation(
      { projectId: 'other-project' },
      async () => {
        calls.push('other');
        return 'other';
      },
    );

    await otherScope;
    expect(calls).toEqual(['first:start', 'other']);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      'first',
      'second',
    ]);
    expect(calls).toEqual([
      'first:start',
      'other',
      'first:end',
      'second',
    ]);
  });

  it('continues scoped history mutations after an earlier operation fails', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = { projectId: 'project' };
    const failure = new Error('save failed');
    const failed = runtime.enqueueCurrentConversationHistoryMutation(
      scope,
      async () => {
        throw failure;
      },
    );
    const recovered = runtime.enqueueCurrentConversationHistoryMutation(
      scope,
      async () => 'saved-after-failure',
    );

    await expect(failed).rejects.toBe(failure);
    await expect(recovered).resolves.toBe('saved-after-failure');
  });

  it('keeps Runtime busy while a background operation survives controller cleanup', async () => {
    const runtime = new WorkbenchConversationRuntime();
    const ownerId = 'html.owner';
    const scope = { projectId: 'project' };
    const initial = conversation('conversation');
    runtime.register(ownerId, contribution('html'));
    runtime.setCurrentConversation(scope, initial);
    runtime.beginCurrentConversationStart(scope, {
      operationId: 'operation',
      expectedConversationId: initial.id,
      conversation: initial,
    });
    expect(runtime.getSnapshot().busy).toBe(true);

    runtime.close();
    runtime.setBusy(ownerId, false);
    expect(runtime.getSnapshot().busy).toBe(true);

    const releaseOwner = runtime.register(ownerId, contribution('html'));
    releaseOwner();
    await Promise.resolve();
    expect(runtime.getSnapshot().busy).toBe(true);

    const resolved = runtime.resolveCurrentConversationStart(scope, {
      operationId: 'operation',
      taskId: 'task',
      assistantMessageId: 'answer',
      mode: 'answer',
      updateConversation: (current) => ({
        ...current,
        messages: [{
          id: 'answer',
          role: 'assistant',
          text: '',
          createdTime: 2,
          generationTaskId: 'task',
        }],
      }),
    });
    expect(resolved?.state.activeTask?.taskId).toBe('task');
    runtime.finishCurrentConversationTask(scope, 'task');
    runtime.register(ownerId, contribution('html'));
    runtime.setBusy(ownerId, false);
    expect(runtime.getSnapshot().busy).toBe(false);
  });

  it('resolves only the matching start operation and merges against the latest revision', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = { projectId: 'project' };
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
    const scope = { projectId: 'project' };
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
    const scope = { projectId: 'project' };
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
    const scope = { projectId: 'project' };
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
    const scope = { projectId: 'project' };
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
    const scope = { projectId: 'project' };
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
    const scope = { projectId: 'project' };
    runtime.setCurrentConversation(scope, conversation('conversation'));

    runtime.dispose();

    expect(runtime.getCurrentConversation(scope)).toBeUndefined();
  });

  it('rejects invalid current conversation scopes and identities', () => {
    const runtime = new WorkbenchConversationRuntime();
    const scope = { projectId: 'project' };

    expect(() => runtime.getCurrentConversation({ projectId: ' ' }))
      .toThrow('Workbench Conversation scope 无效');
    expect(() => runtime.setCurrentConversation(scope, conversation(' ')))
      .toThrow('Workbench Conversation identity 无效');
  });
});
