// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  GenerationTaskEvent,
  GenerationTaskView,
} from '../../shared/generation-tasks';
import type {
  ConversationHistoryStore,
  ConversationRecord,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import {
  useConversationController,
  type ConversationControllerActions,
  type ConversationControllerState,
} from './conversation-controller';
import type { ConversationTaskClient } from './conversation-task-client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ControllerInput = Parameters<typeof useConversationController>[0];
type ControllerValue = {
  readonly state: ConversationControllerState;
  readonly actions: ConversationControllerActions;
};

function task(
  id: string,
  status: GenerationTaskView['status'] = 'processing',
  result?: GenerationTaskView['result'],
): GenerationTaskView {
  return {
    id,
    projectId: 'project',
    definitionId: 'question',
    definitionVersion: 1,
    status,
    ...(result === undefined ? {} : { result }),
    metrics: {},
    createdTime: 10,
    updatedTime: 20,
  };
}

function Harness({
  input,
  onRender,
}: {
  readonly input: ControllerInput;
  readonly onRender: (value: ControllerValue) => void;
}) {
  onRender(useConversationController(input));
  return null;
}

function createMemoryHistory(
  initial: readonly ConversationRecord[] = [],
): ConversationHistoryStore {
  let records = [...initial];
  return {
    list: vi.fn(async () => records),
    save: vi.fn(async (record) => {
      records = [...records.filter((item) => item.id !== record.id), record];
      return records;
    }),
    remove: vi.fn(async (id) => {
      records = records.filter((item) => item.id !== id);
      return records;
    }),
  };
}

function createContribution(input: {
  readonly historyStore?: ConversationHistoryStore;
  readonly onContextReleased?: WorkbenchConversationContribution['onContextReleased'];
  readonly requests?: Array<Record<string, unknown>>;
} = {}): WorkbenchConversationContribution {
  return {
    id: 'test.question',
    workbenchId: 'test',
    title: '测试问答',
    emptyLabel: 'empty',
    historyStore: input.historyStore ?? createMemoryHistory(),
    createTaskRequest(request) {
      input.requests?.push(request as unknown as Record<string, unknown>);
      return {
        projectId: request.projectId,
        definitionId: 'question',
        definitionVersion: 1,
        instruction: {
          conversationId: request.conversationId,
          question: request.question,
        },
        assetReferences: { source: [{ assetId: request.assetId }] },
      };
    },
    readTaskResult(snapshot) {
      const result = snapshot.result as { answer?: unknown; title?: unknown } | undefined;
      return typeof result?.answer === 'string'
        ? {
            answer: result.answer,
            ...(typeof result.title === 'string' ? { title: result.title } : {}),
          }
        : undefined;
    },
    onContextReleased: input.onContextReleased,
  };
}

describe('shared Conversation controller', () => {
  let root: Root;
  let container: HTMLDivElement;
  let latest: ControllerValue;
  let listeners: Set<(event: GenerationTaskEvent) => void>;
  let client: ConversationTaskClient;
  let id = 0;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    listeners = new Set();
    client = {
      start: vi.fn(async () => ({ taskId: 'task-1', snapshot: task('task-1') })),
      retry: vi.fn(async () => ({ taskId: 'task-retry', snapshot: task('task-retry') })),
      get: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    id = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(input: Partial<ControllerInput> = {}) {
    const contribution = input.contribution ?? createContribution();
    act(() => {
      root.render(
        <Harness
          input={{
            open: true,
            projectId: 'project',
            assetId: 'asset',
            contribution,
            taskClient: client,
            createId: () => `id-${++id}`,
            now: () => 100 + id,
            ...input,
          }}
          onRender={(value) => { latest = value; }}
        />,
      );
    });
  }

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function emit(event: GenerationTaskEvent): void {
    act(() => {
      for (const listener of [...listeners]) listener(event);
    });
  }

  it('keeps one conversation identity across Tasks, projects optional deltas, and trusts the final result', async () => {
    const requests: Array<Record<string, unknown>> = [];
    let taskIndex = 0;
    client.start = vi.fn(async () => {
      taskIndex += 1;
      return { taskId: `task-${taskIndex}`, snapshot: task(`task-${taskIndex}`) };
    });
    render({ contribution: createContribution({ requests }) });

    act(() => latest.actions.submit('第一问'));
    await flush();
    emit({
      type: 'execution-event',
      projectId: 'project',
      taskId: 'task-1',
      event: { type: 'assistant-delta', delta: '临时' },
    });
    expect(latest.state.conversation.messages.at(-1)?.text).toBe('临时');
    emit({ type: 'task-completed', snapshot: task('task-1', 'completed', { answer: '第一答' }) });
    expect(latest.state.conversation.messages.at(-1)?.text).toBe('第一答');

    act(() => latest.actions.submit('第二问'));
    await flush();
    expect(requests).toHaveLength(2);
    expect(requests[0]?.conversationId).toBe(requests[1]?.conversationId);
  });

  it('rolls back an unstarted optimistic message and shows a configurable Provider error', async () => {
    const context = { target: { scope: 'asset' } };
    const onContextReleased = vi.fn();
    client.start = vi.fn(async () => {
      throw {
        code: 'AGENT_PROVIDER_SELECTION_REQUIRED',
        kind: 'user',
        message: '请先配置模型',
        retryable: true,
      };
    });
    render({ contribution: createContribution({ onContextReleased }) });

    act(() => latest.actions.submit('问题', context));
    await flush();

    expect(latest.state.conversation.messages).toEqual([]);
    expect(latest.state.draft).toBe('问题');
    expect(latest.state.pendingContext).toEqual(context);
    expect(latest.state.error).toEqual({
      code: 'AGENT_PROVIDER_SELECTION_REQUIRED',
      message: '请先配置模型',
    });
    expect(onContextReleased).not.toHaveBeenCalled();
  });

  it('cancels the real Task even when Stop is pressed before start returns', async () => {
    let resolveStart!: (value: { taskId: string; snapshot: GenerationTaskView }) => void;
    client.start = vi.fn(() => new Promise<{
      taskId: string;
      snapshot: GenerationTaskView;
    }>((resolve) => { resolveStart = resolve; }));
    const onContextReleased = vi.fn();
    render({ contribution: createContribution({ onContextReleased }) });

    act(() => latest.actions.submit('问题', { target: { scope: 'asset' } }));
    act(() => latest.actions.cancel());
    expect(client.cancel).not.toHaveBeenCalled();

    await act(async () => {
      resolveStart({ taskId: 'task-1', snapshot: task('task-1') });
      await Promise.resolve();
    });
    expect(client.cancel).toHaveBeenCalledWith('project', 'task-1');
    expect(onContextReleased).toHaveBeenCalledOnce();
  });

  it('does not leak an early Stop request into the next submission when start fails', async () => {
    let rejectStart!: (reason: unknown) => void;
    client.start = vi.fn(() => new Promise<never>((_resolve, reject) => {
      rejectStart = reject;
    }));
    render();

    act(() => latest.actions.submit('第一次'));
    act(() => latest.actions.cancel());
    await act(async () => {
      rejectStart(new Error('start failed'));
      await Promise.resolve();
    });

    client.start = vi.fn(async () => ({
      taskId: 'task-2',
      snapshot: task('task-2'),
    }));
    act(() => latest.actions.submit('第二次'));
    await flush();

    expect(client.cancel).not.toHaveBeenCalled();
    expect(latest.state.activeTaskId).toBe('task-2');
  });

  it('retries the original failed GenerationTask instead of duplicating the question', async () => {
    client.start = vi.fn(async () => ({
      taskId: 'task-1',
      snapshot: task('task-1', 'failed'),
    }));
    render();
    act(() => latest.actions.submit('会失败'));
    await flush();
    expect(latest.state.error?.retryTaskId).toBe('task-1');

    act(() => latest.actions.retry());
    await flush();
    expect(client.retry).toHaveBeenCalledWith('project', 'task-1');
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(latest.state.conversation.messages.filter(({ role }) => role === 'user'))
      .toHaveLength(1);
  });

  it('restores an explicitly requested history tab only after asynchronous history is ready', async () => {
    let resolveHistory!: (records: readonly ConversationRecord[]) => void;
    const historyStore: ConversationHistoryStore = {
      list: vi.fn(() => new Promise<readonly ConversationRecord[]>((resolve) => {
        resolveHistory = resolve;
      })),
      save: async (record) => [record],
      remove: async () => [],
    };
    const saved: ConversationRecord = {
      id: 'saved-conversation',
      title: '历史对话',
      messages: [
        { id: 'q', role: 'user', text: '旧问题', createdTime: 1 },
        { id: 'a', role: 'assistant', text: '旧回答', createdTime: 2 },
      ],
      createdTime: 1,
      updatedTime: 2,
    };
    const onLaunchConsumed = vi.fn();
    render({
      contribution: createContribution({ historyStore }),
      launchRequest: { id: 1, conversationId: saved.id },
      onLaunchConsumed,
    });
    expect(latest.state.conversation.id).not.toBe(saved.id);
    expect(onLaunchConsumed).not.toHaveBeenCalled();
    await flush();

    await act(async () => {
      resolveHistory([saved]);
      await Promise.resolve();
    });
    expect(latest.state.conversation).toEqual(saved);
    expect(onLaunchConsumed).toHaveBeenCalledWith(1);
  });

  it('does not reload history when the persistence reporter identity changes', async () => {
    const historyStore = createMemoryHistory();
    const contribution = createContribution({ historyStore });

    render({
      contribution,
      onPersistenceError: vi.fn(),
    });
    await flush();
    expect(historyStore.list).toHaveBeenCalledTimes(1);
    expect(latest.state.historyLoading).toBe(false);

    render({
      contribution,
      onPersistenceError: vi.fn(),
    });
    await flush();
    expect(historyStore.list).toHaveBeenCalledTimes(1);
    expect(latest.state.historyLoading).toBe(false);
  });

  it('surfaces a completed Task with no valid answer as a retryable result error', async () => {
    client.start = vi.fn(async () => ({
      taskId: 'task-1',
      snapshot: task('task-1', 'completed', { unrelated: true }),
    }));
    render();
    act(() => latest.actions.submit('问题'));
    await flush();
    expect(latest.state.busy).toBe(false);
    expect(latest.state.error).toMatchObject({
      retryTaskId: 'task-1',
      message: 'AI 任务已完成，但最终回答无效，请重试。',
    });
  });
});
