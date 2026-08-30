// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GenerationTaskView } from '../../shared/generation-tasks';
import type {
  ConversationHistoryStore,
  ConversationRecord,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import { WorkbenchConversationRuntimeProvider } from './WorkbenchConversationRuntimeProvider';
import { WorkbenchConversationRuntime } from './workbench-conversation-runtime';

const taskClientMock = vi.hoisted(() => ({
  start: vi.fn(),
  retry: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
}));

const panelMock = vi.hoisted(() => ({
  latest: undefined as unknown,
}));

vi.mock('./conversation-task-client', () => ({
  conversationTaskClient: taskClientMock,
}));

vi.mock('./ConversationPanel', () => ({
  ConversationPanel: (input: unknown) => {
    panelMock.latest = input;
    return null;
  },
}));

import { ConversationPanelHost } from './ConversationPanelHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function task(id: string): GenerationTaskView {
  return {
    id,
    projectId: 'project',
    definitionId: 'question',
    definitionVersion: 1,
    status: 'processing',
    metrics: {},
    createdTime: 1,
    updatedTime: 2,
  };
}

function completedTask(id: string): GenerationTaskView {
  return {
    ...task(id),
    status: 'completed',
    result: {
      answer: 'background answer',
      providerId: 'codex',
      modelId: 'gpt',
    },
    updatedTime: 3,
  };
}

function contribution(): WorkbenchConversationContribution {
  return {
    id: 'html.assistant',
    workbenchId: 'html',
    contextProviderId: 'html.context',
    title: '网页问答',
    emptyLabel: 'empty',
  };
}

function memoryHistoryStore(): ConversationHistoryStore {
  let history: readonly ConversationRecord[] = [];
  return {
    list: async () => history,
    save: async (record) => {
      history = [...history.filter(({ id }) => id !== record.id), record];
      return history;
    },
    remove: async (conversationId) => {
      history = history.filter(({ id }) => id !== conversationId);
      return history;
    },
  };
}

type PanelProjection = {
  readonly state: {
    readonly activeTaskId?: string;
    readonly busy: boolean;
    readonly conversation: ConversationRecord;
    readonly draft: string;
    readonly pendingContext?: unknown;
    readonly error?: { readonly message: string; readonly code?: string };
  };
  readonly actions: {
    readonly submit: (question: string, context?: unknown) => void;
    readonly cancel: () => void;
    readonly reanswer: (answerId: string) => void;
    readonly restore: (record: ConversationRecord) => void;
    readonly startNew: () => void;
  };
};

const scope = { projectId: 'project' };

describe('Workbench conversation remount lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    panelMock.latest = undefined;
    taskClientMock.start.mockReset();
    taskClientMock.retry.mockReset();
    taskClientMock.get.mockReset();
    taskClientMock.cancel.mockReset();
    taskClientMock.subscribe.mockReset();
    taskClientMock.get.mockResolvedValue(undefined);
    taskClientMock.cancel.mockResolvedValue(undefined);
    taskClientMock.subscribe.mockImplementation(() => () => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function createDeferredStart() {
    let resolveStart!: (value: {
      readonly taskId: string;
      readonly snapshot: GenerationTaskView;
    }) => void;
    let rejectStart!: (reason: unknown) => void;
    taskClientMock.start.mockImplementation(() =>
      new Promise((resolve, reject) => {
        resolveStart = resolve;
        rejectStart = reject;
      }),
    );
    return {
      resolveStart: (taskId = 'task-late') =>
        resolveStart({ taskId, snapshot: task(taskId) }),
      rejectStart: (reason: unknown) => rejectStart(reason),
    };
  }

  function createRuntime(
    initialConversation?: ConversationRecord,
    historyStore = memoryHistoryStore(),
  ) {
    const runtime = new WorkbenchConversationRuntime();
    if (initialConversation) {
      runtime.setCurrentConversation(scope, initialConversation);
    }
    runtime.register('html:workbench-session', contribution());
    runtime.open({ ownerId: 'html:workbench-session' });

    const renderHost = async (mounted: boolean, assetId = 'asset') => {
      await act(async () => {
        root.render(
          <WorkbenchConversationRuntimeProvider runtime={runtime}>
            {mounted ? (
              <ConversationPanelHost
                projectId="project"
                assetId={assetId}
                historyStore={historyStore}
              />
            ) : null}
          </WorkbenchConversationRuntimeProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });
    };
    return { renderHost, runtime };
  }

  it('inherits the pending start across remount and blocks a second submit', async () => {
    createDeferredStart();
    const { renderHost } = createRuntime();

    await renderHost(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.submit(
        'question before remount',
      );
    });
    await renderHost(false);
    await renderHost(true);
    expect((panelMock.latest as PanelProjection).state.busy).toBe(true);
    expect((panelMock.latest as PanelProjection).state.activeTaskId)
      .toBeUndefined();
    const pendingConversationId =
      (panelMock.latest as PanelProjection).state.conversation.id;
    act(() => {
      (panelMock.latest as PanelProjection).actions.submit(
        'must not start concurrently',
      );
      (panelMock.latest as PanelProjection).actions.startNew();
      (panelMock.latest as PanelProjection).actions.restore({
        id: 'must-not-restore',
        title: 'must not restore',
        messages: [],
        createdTime: 5,
        updatedTime: 5,
      });
    });
    expect(taskClientMock.start).toHaveBeenCalledOnce();
    expect((panelMock.latest as PanelProjection).state.conversation.id)
      .toBe(pendingConversationId);
  });

  it('does not overwrite a launch-created conversation during first-mount initialization', async () => {
    const deferred = createDeferredStart();
    const runtime = new WorkbenchConversationRuntime();
    const registeredContribution = contribution();
    const historyStore = memoryHistoryStore();
    runtime.register('html:workbench-session', registeredContribution);
    runtime.open({
      ownerId: 'html:workbench-session',
      fallbackToNewConversation: true,
      question: 'question from launch',
      submit: true,
    });

    await act(async () => {
      root.render(
        <WorkbenchConversationRuntimeProvider runtime={runtime}>
          <ConversationPanelHost
            projectId="project"
            assetId="asset"
            historyStore={historyStore}
          />
        </WorkbenchConversationRuntimeProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(taskClientMock.start).toHaveBeenCalledOnce();
    expect(runtime.getCurrentConversation(scope))
      .toBe((panelMock.latest as PanelProjection).state.conversation);

    await act(async () => {
      deferred.resolveStart('task-from-launch');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('merges a late taskId without overwriting a newer same-conversation projection', async () => {
    const deferred = createDeferredStart();
    taskClientMock.get.mockResolvedValue(task('task-late'));
    const { renderHost, runtime } = createRuntime();

    await renderHost(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.submit('first question');
    });
    await renderHost(false);
    await renderHost(true);
    const pendingConversation = runtime.getCurrentConversation(scope)!;
    const originalAssistant = pendingConversation.messages.at(-1)!;
    const newerProjection: ConversationRecord = {
      ...pendingConversation,
      messages: [
        ...pendingConversation.messages,
        {
          id: 'newer-question',
          role: 'user',
          text: 'newer question',
          createdTime: 30,
        },
        {
          id: 'newer-answer',
          role: 'assistant',
          text: 'newer answer',
          createdTime: 31,
          replyToMessageId: 'newer-question',
        },
      ],
      updatedTime: 31,
    };
    await act(async () => {
      runtime.setCurrentConversation(scope, newerProjection);
      await Promise.resolve();
    });

    await act(async () => {
      deferred.resolveStart();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((panelMock.latest as PanelProjection).state.conversation.messages)
      .toHaveLength(4);
    expect(
      (panelMock.latest as PanelProjection).state.conversation.messages.find(
        ({ id }) => id === originalAssistant.id,
      )?.generationTaskId,
    ).toBe('task-late');
    expect(taskClientMock.get).toHaveBeenCalledWith('project', 'task-late');
    expect((panelMock.latest as PanelProjection).state.activeTaskId)
      .toBe('task-late');
    expect((panelMock.latest as PanelProjection).state.busy).toBe(true);
  });

  it('inherits a bound active task across Workbench and Asset changes before delayed recovery', async () => {
    const deferred = createDeferredStart();
    let resolveRecovery!: (snapshot: GenerationTaskView | undefined) => void;
    taskClientMock.get.mockImplementation(() =>
      new Promise<GenerationTaskView | undefined>((resolve) => {
        resolveRecovery = resolve;
      }),
    );
    const { renderHost, runtime } = createRuntime();

    await renderHost(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.submit('first question');
    });
    await act(async () => {
      deferred.resolveStart('task-active');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const activeConversation =
      (panelMock.latest as PanelProjection).state.conversation;
    const activeAnswerId = activeConversation.messages.at(-1)!.id;

    await renderHost(false);
    expect(runtime.getSnapshot().busy).toBe(true);
    const nextContribution = {
      ...contribution(),
      id: 'video.frame-conversation',
      workbenchId: 'video',
      contextProviderId: 'video.context',
    };
    runtime.register('video:workbench-session', nextContribution);
    runtime.open({ ownerId: 'video:workbench-session' });
    await renderHost(true, 'asset-b');

    const remounted = panelMock.latest as PanelProjection;
    expect(taskClientMock.get).toHaveBeenCalledWith('project', 'task-active');
    expect(remounted.state.busy).toBe(true);
    expect(remounted.state.activeTaskId).toBe('task-active');
    act(() => {
      remounted.actions.submit('must stay blocked');
      remounted.actions.startNew();
      remounted.actions.restore({
        id: 'must-not-restore',
        title: 'must not restore',
        messages: [],
        createdTime: 50,
        updatedTime: 50,
      });
      remounted.actions.reanswer(activeAnswerId);
    });

    expect(taskClientMock.start).toHaveBeenCalledOnce();
    expect((panelMock.latest as PanelProjection).state.conversation.id)
      .toBe(activeConversation.id);
    expect(runtime.getCurrentConversation(scope)?.id)
      .toBe(activeConversation.id);

    await act(async () => {
      resolveRecovery(task('task-active'));
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('settles a task completed in the background and releases the Conversation for its next turn', async () => {
    const deferred = createDeferredStart();
    let resolveRecovery!: (snapshot: GenerationTaskView | undefined) => void;
    taskClientMock.get.mockImplementation(() =>
      new Promise<GenerationTaskView | undefined>((resolve) => {
        resolveRecovery = resolve;
      }),
    );
    const { renderHost, runtime } = createRuntime();

    await renderHost(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.submit('first question');
    });
    await act(async () => {
      deferred.resolveStart('task-background');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const conversationId =
      (panelMock.latest as PanelProjection).state.conversation.id;

    await renderHost(false);
    await renderHost(true);
    expect((panelMock.latest as PanelProjection).state.busy).toBe(true);

    await act(async () => {
      resolveRecovery(completedTask('task-background'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const settled = panelMock.latest as PanelProjection;
    expect(settled.state.busy).toBe(false);
    expect(settled.state.activeTaskId).toBeUndefined();
    expect(settled.state.conversation.id).toBe(conversationId);
    expect(settled.state.conversation.messages.at(-1)?.text)
      .toBe('background answer');
    expect(runtime.getCurrentConversationState(scope)?.activeTask)
      .toBeUndefined();

    act(() => {
      settled.actions.submit('next question');
    });
    expect(taskClientMock.start).toHaveBeenCalledTimes(2);
    expect((panelMock.latest as PanelProjection).state.conversation.id)
      .toBe(conversationId);
  });

  it('does not let a stale controller persistence write overwrite a remounted completion', async () => {
    const deferred = createDeferredStart();
    const pendingSaves: Array<{
      readonly record: ConversationRecord;
      readonly resolve: (records: readonly ConversationRecord[]) => void;
    }> = [];
    let persisted: ConversationRecord | undefined;
    const historyStore: ConversationHistoryStore = {
      ...memoryHistoryStore(),
      save: vi.fn((record: ConversationRecord) =>
        new Promise<readonly ConversationRecord[]>((resolve) => {
          pendingSaves.push({ record, resolve });
        }),
      ),
    };
    taskClientMock.get.mockResolvedValue(completedTask('task-persist'));
    const { renderHost } = createRuntime(undefined, historyStore);

    await renderHost(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.submit('persist across remount');
    });
    await renderHost(false);
    expect(pendingSaves).toHaveLength(1);

    await renderHost(true);
    await act(async () => {
      deferred.resolveStart('task-persist');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pendingSaves).toHaveLength(1);

    await act(async () => {
      persisted = pendingSaves[0]!.record;
      pendingSaves[0]!.resolve([pendingSaves[0]!.record]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pendingSaves).toHaveLength(2);
    expect(pendingSaves[1]!.record.messages.at(-1)?.text).toBe('');

    await act(async () => {
      persisted = pendingSaves[1]!.record;
      pendingSaves[1]!.resolve([pendingSaves[1]!.record]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pendingSaves).toHaveLength(3);
    expect(pendingSaves[2]!.record.messages.at(-1)?.text)
      .toBe('background answer');

    await act(async () => {
      persisted = pendingSaves[2]!.record;
      pendingSaves[2]!.resolve([pendingSaves[2]!.record]);
      await Promise.resolve();
    });
    expect(persisted?.messages.at(-1)?.text).toBe('background answer');
  });

  it('keeps the active task locked when recovery lookup fails', async () => {
    const deferred = createDeferredStart();
    const { renderHost } = createRuntime();

    await renderHost(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.submit('first question');
    });
    await act(async () => {
      deferred.resolveStart('task-recovery-error');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    taskClientMock.get.mockRejectedValue(new Error('lookup failed'));

    await renderHost(false);
    await renderHost(true);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const remounted = panelMock.latest as PanelProjection;
    expect(remounted.state.busy).toBe(true);
    expect(remounted.state.activeTaskId).toBe('task-recovery-error');
    expect(remounted.state.error?.message).toBe('无法恢复这次回答。');
    act(() => {
      remounted.actions.submit('must stay blocked');
    });
    expect(taskClientMock.start).toHaveBeenCalledOnce();
  });

  it('hands a late start failure draft, context and error to the remounted controller', async () => {
    const deferred = createDeferredStart();
    let history: readonly ConversationRecord[] = [];
    let resolveOptimisticSave!: () => void;
    const historyStore: ConversationHistoryStore = {
      list: async () => history,
      save: vi.fn((record: ConversationRecord) =>
        new Promise<readonly ConversationRecord[]>((resolve) => {
          resolveOptimisticSave = () => {
            history = [record];
            resolve(history);
          };
        }),
      ),
      remove: vi.fn(async (conversationId) => {
        history = history.filter(({ id }) => id !== conversationId);
        return history;
      }),
    };
    const { renderHost } = createRuntime(undefined, historyStore);
    const context = { target: { scope: 'selection' } };

    await renderHost(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.submit(
        'question to restore',
        context,
      );
    });
    await renderHost(false);
    await renderHost(true);

    await act(async () => {
      deferred.rejectStart({
        code: 'AGENT_PROVIDER_SELECTION_REQUIRED',
        kind: 'user',
        message: '请先配置模型',
        retryable: true,
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const state = (panelMock.latest as PanelProjection).state;
    expect(state.busy).toBe(false);
    expect(state.conversation.messages).toEqual([]);
    expect(state.draft).toBe('question to restore');
    expect(state.pendingContext).toEqual(context);
    expect(state.error).toEqual({
      code: 'AGENT_PROVIDER_SELECTION_REQUIRED',
      message: '请先配置模型',
    });
    expect(historyStore.remove).not.toHaveBeenCalled();
    await act(async () => {
      resolveOptimisticSave();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(historyStore.remove).toHaveBeenCalledOnce();
    await expect(historyStore.list()).resolves.toEqual([]);
  });

  it('preserves a pending cancel request until the late taskId arrives', async () => {
    const deferred = createDeferredStart();
    const { renderHost } = createRuntime();

    await renderHost(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.submit('question to stop');
    });
    await renderHost(false);
    await renderHost(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.cancel();
    });
    expect((panelMock.latest as PanelProjection).state.busy).toBe(true);

    await act(async () => {
      deferred.resolveStart('task-cancelled-late');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(taskClientMock.cancel).toHaveBeenCalledWith(
      'project',
      'task-cancelled-late',
    );
  });

  it('inherits a pending reanswer start and prevents a second operation', async () => {
    const deferred = createDeferredStart();
    taskClientMock.get.mockImplementation(
      async (_projectId: string, taskId: string) =>
        taskId === 'task-reanswer' ? task(taskId) : undefined,
    );
    const initialConversation: ConversationRecord = {
      id: 'conversation-with-answer',
      title: 'conversation',
      messages: [
        { id: 'question', role: 'user', text: 'question', createdTime: 1 },
        {
          id: 'answer',
          role: 'assistant',
          text: 'old answer',
          createdTime: 2,
          replyToMessageId: 'question',
          generationTaskId: 'task-old',
        },
      ],
      createdTime: 1,
      updatedTime: 2,
    };
    const { renderHost } = createRuntime(initialConversation);

    await renderHost(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.reanswer('answer');
    });
    await renderHost(false);
    await renderHost(true);
    expect((panelMock.latest as PanelProjection).state.busy).toBe(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.submit('must be blocked');
      (panelMock.latest as PanelProjection).actions.reanswer('answer');
    });
    expect(taskClientMock.start).toHaveBeenCalledOnce();

    await act(async () => {
      deferred.resolveStart('task-reanswer');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      (panelMock.latest as PanelProjection).state.conversation.messages.find(
        ({ id }) => id === 'answer',
      )?.generationTaskId,
    ).toBe('task-reanswer');
  });

  it('does not let a late start move the Runtime pointer back after a conversation switch', async () => {
    const deferred = createDeferredStart();
    const { renderHost, runtime } = createRuntime();

    await renderHost(true);
    act(() => {
      (panelMock.latest as PanelProjection).actions.submit('old question');
    });
    await renderHost(false);
    await renderHost(true);
    const switchedConversation: ConversationRecord = {
      id: 'switched-conversation',
      title: 'switched',
      messages: [],
      createdTime: 40,
      updatedTime: 40,
    };
    await act(async () => {
      runtime.setCurrentConversation(scope, switchedConversation);
      await Promise.resolve();
    });

    await act(async () => {
      deferred.resolveStart();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runtime.getCurrentConversation(scope)).toBe(switchedConversation);
    expect((panelMock.latest as PanelProjection).state.conversation)
      .toBe(switchedConversation);
    expect(taskClientMock.cancel).toHaveBeenCalledWith('project', 'task-late');
  });
});
