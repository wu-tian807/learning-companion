// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  GenerationTaskEvent,
  GenerationTaskView,
} from '../../shared/generation-tasks';
import type {
  ConversationContextAttachment,
  ConversationHistoryStore,
  ConversationLaunchRequest,
  ConversationRecord,
  ConversationTaskInput,
  WorkbenchConversationContribution,
} from './conversation-contracts';
import {
  useConversationController,
  type ConversationControllerActions,
  type ConversationControllerState,
} from './conversation-controller';
import type { ConversationTaskClient } from './conversation-task-client';
import type { ConversationModeDefinition } from './conversation-mode';

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
  readonly onContextReleased?: WorkbenchConversationContribution['onContextReleased'];
} = {}): WorkbenchConversationContribution {
  return {
    contextProviderId: 'test.context',
    sourceAssetMode: 'reference',
    onContextReleased: input.onContextReleased,
  };
}

function createContextAttachment(
  context: ConversationContextAttachment['context'],
  contribution = createContribution(),
): ConversationContextAttachment {
  return {
    assetId: 'asset',
    contribution,
    ...(context === undefined ? {} : { context }),
  };
}

function createContextLaunch(
  context: ConversationContextAttachment['context'],
  input: Omit<
    ConversationLaunchRequest,
    'context' | 'contextSource'
  >,
  contribution = createContribution(),
): ConversationLaunchRequest {
  const attachment = createContextAttachment(context, contribution);
  return {
    ...input,
    contextSource: {
      assetId: attachment.assetId,
      contribution: attachment.contribution,
    },
    ...(context === undefined ? {} : { context }),
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
    act(() => {
      root.render(
        <Harness
          input={{
            open: true,
            projectId: 'project',
            historyStore: createMemoryHistory(),
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
    const requests: Array<Parameters<ConversationTaskClient['start']>[0]> = [];
    let taskIndex = 0;
    client.start = vi.fn(async (request) => {
      requests.push(request);
      taskIndex += 1;
      return { taskId: `task-${taskIndex}`, snapshot: task(`task-${taskIndex}`) };
    });
    render();

    act(() => latest.actions.submit('第一问'));
    await flush();
    emit({
      type: 'execution-event',
      projectId: 'project',
      taskId: 'task-1',
      event: { type: 'assistant-delta', delta: '临时' },
    });
    expect(latest.state.conversation.messages.at(-1)?.text).toBe('临时');
    emit({
      type: 'task-completed',
      snapshot: task('task-1', 'completed', {
        answer: '第一答',
        providerId: 'codex',
        modelId: 'gpt',
      }),
    });
    expect(latest.state.conversation.messages.at(-1)?.text).toBe('第一答');

    act(() => latest.actions.submit('第二问'));
    await flush();
    expect(requests).toHaveLength(2);
    expect(
      (requests[0]?.instruction as { conversationId?: string })
        .conversationId,
    ).toBe(
      (requests[1]?.instruction as { conversationId?: string })
        .conversationId,
    );
  });

  it('reuses the controller with a mode-specific Task adapter and workspace', async () => {
    const createRequest = vi.fn((input: ConversationTaskInput) => ({
      projectId: input.projectId,
      definitionId: 'learning-outline.planning',
      definitionVersion: 1,
      instruction: {
        conversationId: input.conversationId,
        question: input.question,
        ...(input.workspace ? { workspace: input.workspace } : {}),
      },
      assetReferences: {},
    }));
    const mode: ConversationModeDefinition = {
      id: 'learning-outline.planning',
      task: {
        createRequest,
        readCompletion(completed) {
          const result = completed.result;
          const reply =
            typeof result === 'object' &&
            result !== null &&
            !Array.isArray(result)
              ? (result as Readonly<Record<string, unknown>>).reply
              : undefined;
          if (
            typeof reply !== 'string'
          ) {
            return undefined;
          }
          return { answer: reply, modelInfo: 'test/planner' };
        },
      },
      presentation: {
        title: '学习大纲规划',
        ariaLabel: '学习大纲规划',
        emptyLabel: '先确认学习目标',
        inputPlaceholder: '补充你的学习要求…',
      },
    };
    const historyStore = createMemoryHistory([
      {
        id: 'general-history',
        modeId: 'project.general',
        title: '普通聊天',
        messages: [],
        createdTime: 1,
        updatedTime: 1,
      },
      {
        id: 'outline-history',
        modeId: mode.id,
        workspace: { instanceKey: 'outline-draft-old' },
        title: '大纲聊天',
        messages: [],
        createdTime: 2,
        updatedTime: 2,
      },
    ]);

    render({
      historyStore,
      mode,
      workspace: { instanceKey: 'outline-draft-1' },
    });
    await flush();

    expect(latest.state.conversation).toMatchObject({
      modeId: mode.id,
      workspace: { instanceKey: 'outline-draft-1' },
    });
    expect(latest.state.history.map(({ id }) => id)).toEqual([
      'outline-history',
    ]);

    act(() => latest.actions.submit('我希望系统学习'));
    await flush();
    expect(createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: { instanceKey: 'outline-draft-1' },
        question: '我希望系统学习',
      }),
    );

    emit({
      type: 'task-completed',
      snapshot: task('task-1', 'completed', {
        reply: '先确认你的已有基础。',
      }),
    });
    expect(latest.state.conversation.messages.at(-1)?.text).toBe(
      '先确认你的已有基础。',
    );
  });

  it('keeps an existing workspace binding and applies a changed default only to a new conversation', async () => {
    const requests: Array<Parameters<ConversationTaskClient['start']>[0]> = [];
    client.start = vi.fn(async (request) => {
      requests.push(request);
      return { taskId: 'task-1', snapshot: task('task-1') };
    });
    const historyStore = createMemoryHistory();
    render({
      historyStore,
      workspace: { instanceKey: 'workspace-1' },
    });
    const firstConversationId = latest.state.conversation.id;

    render({
      historyStore,
      workspace: { instanceKey: 'workspace-2' },
    });
    expect(latest.state.conversation).toMatchObject({
      id: firstConversationId,
      workspace: { instanceKey: 'workspace-1' },
    });

    act(() => latest.actions.submit('仍然使用原工作区'));
    await flush();
    expect(requests[0]?.instruction).toMatchObject({
      workspace: { instanceKey: 'workspace-1' },
    });
    emit({
      type: 'task-completed',
      snapshot: task('task-1', 'completed', {
        answer: '完成',
        providerId: 'test',
        modelId: 'test',
      }),
    });

    act(() => latest.actions.startNew());
    expect(latest.state.conversation).toMatchObject({
      workspace: { instanceKey: 'workspace-2' },
    });
    expect(latest.state.conversation.id).not.toBe(firstConversationId);
  });

  it('uses Workbench context for only the attached turn and sends the next message through Project Conversation', async () => {
    const requests: Array<
      Parameters<ConversationTaskClient['start']>[0]
    > = [];
    let taskIndex = 0;
    client.start = vi.fn(async (request) => {
      requests.push(request);
      taskIndex += 1;
      return {
        taskId: `task-${taskIndex}`,
        snapshot: task(`task-${taskIndex}`),
      };
    });
    const context = { target: { scope: 'asset' } };
    const contextualContribution = createContribution();
    render();

    act(() =>
      latest.actions.submit(
        '解释这段内容',
        createContextAttachment(context, contextualContribution),
      ),
    );
    await flush();
    emit({
      type: 'task-completed',
      snapshot: task('task-1', 'completed', {
        answer: '上下文回答',
        providerId: 'codex',
        modelId: 'gpt',
      }),
    });
    act(() => latest.actions.submit('继续说明一个普通问题'));
    await flush();

    expect(requests[0]).toMatchObject({
      instruction: {
        contextProviderId: 'test.context',
        assetId: 'asset',
        context,
      },
      assetReferences: {
        source: [{ assetId: 'asset' }],
      },
    });
    expect(requests[1]).toMatchObject({
      instruction: {
        contextProviderId: 'builtin.project.conversation',
        question: '继续说明一个普通问题',
      },
      assetReferences: {},
    });
    expect(
      latest.state.conversation.messages.filter(
        (message) => message.role === 'user',
      )[1]?.contextSource,
    ).toBeUndefined();
  });

  it('keeps and persists a sent question when Provider startup fails', async () => {
    const context = { target: { scope: 'asset' } };
    const onContextReleased = vi.fn();
    const historyStore = createMemoryHistory();
    client.start = vi.fn(async () => {
      throw {
        code: 'AGENT_PROVIDER_SELECTION_REQUIRED',
        kind: 'user',
        message: '请先配置模型',
        retryable: true,
      };
    });
    const attachment = createContextAttachment(
      context,
      createContribution({ onContextReleased }),
    );
    render({ historyStore });

    act(() => latest.actions.submit('问题', attachment));
    await flush();

    expect(latest.state.conversation.messages).toEqual([
      expect.objectContaining({ role: 'user', text: '问题', context }),
    ]);
    expect(latest.state.draft).toBe('');
    expect(latest.state.pendingContext).toBeUndefined();
    expect(historyStore.save).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ role: 'user', text: '问题', context })],
    }));
    expect(latest.state.error).toEqual({
      code: 'AGENT_PROVIDER_SELECTION_REQUIRED',
      message: '请先配置模型',
    });
    expect(onContextReleased).toHaveBeenCalledWith(context);
  });

  it('persists a sent question before the Generation Task is accepted', async () => {
    let resolveStart!: (value: {
      taskId: string;
      snapshot: GenerationTaskView;
    }) => void;
    client.start = vi.fn(() =>
      new Promise<{
        taskId: string;
        snapshot: GenerationTaskView;
      }>((resolve) => {
        resolveStart = resolve;
      }),
    );
    const historyStore = createMemoryHistory();
    render({ historyStore });

    act(() => latest.actions.submit('立即保存的问题'));
    await act(async () => { await Promise.resolve(); });

    expect(historyStore.save).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', text: '立即保存的问题' }),
      ]),
    }));
    expect(latest.state.busy).toBe(true);

    await act(async () => {
      resolveStart({ taskId: 'task-1', snapshot: task('task-1') });
      await Promise.resolve();
    });
  });

  it('cancels the real Task even when Stop is pressed before start returns', async () => {
    let resolveStart!: (value: { taskId: string; snapshot: GenerationTaskView }) => void;
    client.start = vi.fn(() => new Promise<{
      taskId: string;
      snapshot: GenerationTaskView;
    }>((resolve) => { resolveStart = resolve; }));
    const onContextReleased = vi.fn();
    const context = { target: { scope: 'asset' } };
    const attachment = createContextAttachment(
      context,
      createContribution({ onContextReleased }),
    );
    render();

    act(() => latest.actions.submit('问题', attachment));
    act(() => latest.actions.cancel());
    expect(client.cancel).not.toHaveBeenCalled();

    await act(async () => {
      resolveStart({ taskId: 'task-1', snapshot: task('task-1') });
      await Promise.resolve();
    });
    expect(client.cancel).toHaveBeenCalledWith('project', 'task-1');
    expect(onContextReleased).toHaveBeenCalledOnce();
  });

  it('releases context through the contribution that created the pending Task', async () => {
    let resolveStart!: (value: {
      taskId: string;
      snapshot: GenerationTaskView;
    }) => void;
    client.start = vi.fn(() =>
      new Promise<{
        taskId: string;
        snapshot: GenerationTaskView;
      }>((resolve) => {
        resolveStart = resolve;
      }),
    );
    const originalRelease = vi.fn();
    const historyStore = createMemoryHistory();
    const context = { target: { scope: 'asset' } };
    const attachment = createContextAttachment(
      context,
      createContribution({
        onContextReleased: originalRelease,
      }),
    );
    render({ historyStore });

    act(() => latest.actions.submit('问题', attachment));
    render({ historyStore });
    await act(async () => {
      resolveStart({ taskId: 'task-1', snapshot: task('task-1') });
      await Promise.resolve();
    });

    expect(originalRelease).toHaveBeenCalledWith(context);
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

  it('cancels the real retry Task when Stop is pressed before retry returns', async () => {
    client.start = vi.fn(async () => ({
      taskId: 'task-1',
      snapshot: task('task-1', 'failed'),
    }));
    render();
    act(() => latest.actions.submit('会失败'));
    await flush();

    let resolveRetry!: (value: {
      taskId: string;
      snapshot: GenerationTaskView;
    }) => void;
    client.retry = vi.fn(() => new Promise<{
      taskId: string;
      snapshot: GenerationTaskView;
    }>((resolve) => {
      resolveRetry = resolve;
    }));
    act(() => latest.actions.retry());
    act(() => latest.actions.cancel());
    expect(client.cancel).not.toHaveBeenCalled();

    await act(async () => {
      resolveRetry({ taskId: 'task-2', snapshot: task('task-2') });
      await Promise.resolve();
    });

    expect(client.cancel).toHaveBeenCalledWith('project', 'task-2');
  });

  it('re-answers a completed answer with the same question and context without duplicating messages', async () => {
    const requests: Array<Parameters<ConversationTaskClient['start']>[0]> = [];
    let taskIndex = 0;
    client.start = vi.fn(async (request) => {
      requests.push(request);
      taskIndex += 1;
      return { taskId: `task-${taskIndex}`, snapshot: task(`task-${taskIndex}`) };
    });
    render();

    const context = { target: { scope: 'asset' as const } };
    act(() =>
      latest.actions.submit(
        '请解释这段内容',
        createContextAttachment(context),
      ),
    );
    await flush();
    emit({
      type: 'task-completed',
      snapshot: task('task-1', 'completed', {
        answer: '第一版回答',
        providerId: 'codex',
        modelId: 'gpt',
      }),
    });
    expect(latest.state.conversation.messages.at(-1)?.text).toBe('第一版回答');

    const assistantId = latest.state.conversation.messages.at(-1)!.id;
    act(() => latest.actions.reanswer(assistantId));
    await flush();

    expect(client.start).toHaveBeenCalledTimes(2);
    const second = requests[1]!.instruction as {
      question: string;
      context?: unknown;
      generateTitle?: boolean;
      conversationId: string;
    };
    expect(second.question).toBe('请解释这段内容');
    expect(second.context).toEqual(context);
    expect(second.generateTitle).toBeUndefined();
    expect(second.conversationId).toBe(latest.state.conversation.id);
    expect(
      latest.state.conversation.messages.filter(({ role }) => role === 'user'),
    ).toHaveLength(1);
    expect(latest.state.conversation.messages).toHaveLength(2);
    expect(latest.state.activityLabel).toBe('正在重新回答…');
    expect(latest.state.conversation.messages.at(-1)).toMatchObject({
      text: '',
      generationTaskId: 'task-2',
      reanswerBackup: {
        text: '第一版回答',
        generationTaskId: 'task-1',
        modelInfo: 'codex/gpt',
      },
    });

    emit({
      type: 'execution-event',
      projectId: 'project',
      taskId: 'task-2',
      event: { type: 'assistant-delta', delta: '第二版流式内容' },
    });
    expect(latest.state.conversation.messages.at(-1)?.text).toBe(
      '第二版流式内容',
    );

    emit({
      type: 'task-completed',
      snapshot: task('task-2', 'completed', {
        answer: '第二版回答',
        providerId: 'codex',
        modelId: 'gpt',
      }),
    });
    expect(latest.state.conversation.messages.at(-1)?.text).toBe('第二版回答');
    expect(latest.state.conversation.messages.at(-1)?.generationTaskId).toBe(
      'task-2',
    );
    expect(
      latest.state.conversation.messages.at(-1)?.reanswerBackup,
    ).toBeUndefined();
  });

  it('does not guess a Workbench source for unattributed context during re-answer', () => {
    const saved: ConversationRecord = {
      id: 'legacy-context',
      modeId: 'project.general',
      title: '旧上下文',
      messages: [
        {
          id: 'question',
          role: 'user',
          text: '解释旧选区',
          createdTime: 1,
          context: { legacy: true },
        },
        {
          id: 'answer',
          role: 'assistant',
          text: '旧回答',
          createdTime: 2,
          replyToMessageId: 'question',
        },
      ],
      createdTime: 1,
      updatedTime: 2,
    };
    render();
    act(() => latest.actions.restore(saved));

    act(() => latest.actions.reanswer('answer'));

    expect(client.start).not.toHaveBeenCalled();
    expect(latest.state.error?.message).toBe(
      '这条旧问答缺少上下文来源，请从原文重新发起。',
    );
  });

  it('cancels the replacement Task when Stop is pressed before re-answer start returns', async () => {
    render();
    act(() => latest.actions.submit('问题'));
    await flush();
    emit({
      type: 'task-completed',
      snapshot: task('task-1', 'completed', {
        answer: '稳定旧回答',
        providerId: 'codex',
        modelId: 'gpt',
      }),
    });

    let resolveStart!: (value: {
      taskId: string;
      snapshot: GenerationTaskView;
    }) => void;
    client.start = vi.fn(() => new Promise<{
      taskId: string;
      snapshot: GenerationTaskView;
    }>((resolve) => {
      resolveStart = resolve;
    }));
    const assistantId = latest.state.conversation.messages.at(-1)!.id;

    act(() => latest.actions.reanswer(assistantId));
    act(() => latest.actions.cancel());
    expect(client.cancel).not.toHaveBeenCalled();

    await act(async () => {
      resolveStart({ taskId: 'task-2', snapshot: task('task-2') });
      await Promise.resolve();
    });

    expect(client.cancel).toHaveBeenCalledWith('project', 'task-2');
    expect(latest.state.conversation.messages.at(-1)).toMatchObject({
      text: '',
      generationTaskId: 'task-2',
      reanswerBackup: {
        text: '稳定旧回答',
        generationTaskId: 'task-1',
      },
    });
  });

  it('does not leak an early re-answer Stop into the next replacement Task when start fails', async () => {
    render();
    act(() => latest.actions.submit('问题'));
    await flush();
    emit({
      type: 'task-completed',
      snapshot: task('task-1', 'completed', {
        answer: '稳定旧回答',
        providerId: 'codex',
        modelId: 'gpt',
      }),
    });
    const assistantId = latest.state.conversation.messages.at(-1)!.id;

    let rejectStart!: (reason: unknown) => void;
    client.start = vi.fn(() => new Promise<never>((_resolve, reject) => {
      rejectStart = reject;
    }));
    act(() => latest.actions.reanswer(assistantId));
    act(() => latest.actions.cancel());
    await act(async () => {
      rejectStart(new Error('start failed'));
      await Promise.resolve();
    });

    client.start = vi.fn(async () => ({
      taskId: 'task-3',
      snapshot: task('task-3'),
    }));
    act(() => latest.actions.reanswer(assistantId));
    await flush();

    expect(client.cancel).not.toHaveBeenCalled();
    expect(latest.state.activeTaskId).toBe('task-3');
  });

  it('restores the previous answer after a running re-answer fails and clears it again on retry', async () => {
    let taskIndex = 0;
    client.start = vi.fn(async () => {
      taskIndex += 1;
      return { taskId: `task-${taskIndex}`, snapshot: task(`task-${taskIndex}`) };
    });
    client.retry = vi.fn(async () => ({
      taskId: 'task-3',
      snapshot: task('task-3'),
    }));
    render();
    act(() => latest.actions.submit('问题'));
    await flush();
    emit({
      type: 'task-completed',
      snapshot: task('task-1', 'completed', {
        answer: '稳定旧回答',
        providerId: 'codex',
        modelId: 'gpt',
      }),
    });

    const assistantId = latest.state.conversation.messages.at(-1)!.id;
    act(() => latest.actions.reanswer(assistantId));
    await flush();
    emit({
      type: 'execution-event',
      projectId: 'project',
      taskId: 'task-2',
      event: { type: 'assistant-delta', delta: '不完整新回答' },
    });
    emit({
      type: 'task-changed',
      snapshot: task('task-2', 'failed'),
    });

    expect(latest.state.conversation.messages.at(-1)).toMatchObject({
      text: '稳定旧回答',
      generationTaskId: 'task-2',
      reanswerBackup: {
        text: '稳定旧回答',
        generationTaskId: 'task-1',
      },
    });
    expect(latest.state.error?.retryTaskId).toBe('task-2');

    act(() => latest.actions.retry());
    await flush();
    expect(latest.state.conversation.messages.at(-1)?.text).toBe('');
    emit({
      type: 'execution-event',
      projectId: 'project',
      taskId: 'task-3',
      event: { type: 'assistant-delta', delta: '重试新回答' },
    });
    expect(latest.state.conversation.messages.at(-1)?.text).toBe(
      '重试新回答',
    );
  });

  it('reports a failed re-answer without duplicating or clearing messages', async () => {
    client.start = vi.fn(async () => ({
      taskId: 'task-1',
      snapshot: task('task-1', 'completed', {
        answer: '旧回答',
        providerId: 'codex',
        modelId: 'gpt',
      }),
    }));
    render();
    act(() => latest.actions.submit('问题'));
    await flush();
    const assistantId = latest.state.conversation.messages.at(-1)!.id;

    client.start = vi.fn(async () => {
      throw new Error('provider down');
    });
    act(() => latest.actions.reanswer(assistantId));
    await flush();

    expect(latest.state.error?.message).toBe('无法重新回答。');
    expect(latest.state.busy).toBe(false);
    expect(latest.state.conversation.messages).toHaveLength(2);
    expect(latest.state.conversation.messages.at(-1)?.text).toBe('旧回答');
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
      modeId: 'project.general',
      title: '历史对话',
      messages: [
        { id: 'q', role: 'user', text: '旧问题', createdTime: 1 },
        { id: 'a', role: 'assistant', text: '旧回答', createdTime: 2 },
      ],
      createdTime: 1,
      updatedTime: 2,
    };
    const onLaunchConsumed = vi.fn();
    const context = { target: { scope: 'saved-selection' } };
    render({
      historyStore,
      launchRequest: createContextLaunch(context, {
        id: 1,
        conversationId: saved.id,
      }),
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
    expect(latest.state.pendingContext).toBeUndefined();
    expect(onLaunchConsumed).toHaveBeenCalledWith(1);
  });

  it('reuses an exact current identity and creates context-bound fallbacks only when unavailable', async () => {
    const historyStore = createMemoryHistory();
    const contribution = createContribution();
    render({ historyStore });
    await flush();
    const previousConversationId = latest.state.conversation.id;
    render({
      historyStore,
      launchRequest: createContextLaunch(
        { target: { scope: 'must-not-rebind' } },
        {
        id: 1,
        conversationId: previousConversationId,
        },
        contribution,
      ),
    });
    await flush();
    expect(latest.state.conversation.id).toBe(previousConversationId);
    expect(latest.state.pendingContext).toBeUndefined();

    const context = { target: { scope: 'missing-history-fallback' } };

    render({
      historyStore,
      launchRequest: createContextLaunch(context, {
        id: 2,
        conversationId: 'missing-conversation',
      }, contribution),
    });
    await flush();

    expect(latest.state.conversation.id).not.toBe(previousConversationId);
    expect(latest.state.pendingContext).toEqual(
      createContextAttachment(context, contribution),
    );

    const unavailableConversationFallbackId = latest.state.conversation.id;
    render({
      historyStore,
      launchRequest: createContextLaunch(
        { target: { scope: 'unlinked-marker' } },
        {
        id: 3,
        fallbackToNewConversation: true,
        },
        contribution,
      ),
    });
    await flush();
    expect(latest.state.conversation.id).not.toBe(
      unavailableConversationFallbackId,
    );
    expect(latest.state.pendingContext).toEqual(
      createContextAttachment(
        { target: { scope: 'unlinked-marker' } },
        contribution,
      ),
    );
  });

  it('keeps a context launch in the currently selected conversation', async () => {
    const historyStore = createMemoryHistory();
    const contribution = createContribution();
    render({ historyStore });
    await flush();

    act(() => latest.actions.submit('当前会话中的问题'));
    await flush();
    emit({
      type: 'task-completed',
      snapshot: task('task-1', 'completed', {
        answer: '当前会话中的回答',
        providerId: 'codex',
        modelId: 'gpt',
      }),
    });
    await flush();
    const selectedConversationId = latest.state.conversation.id;
    const context = { target: { scope: 'current-page' } };
    const onLaunchConsumed = vi.fn();

    render({
      historyStore,
      launchRequest: createContextLaunch(
        context,
        { id: 1 },
        contribution,
      ),
      onLaunchConsumed,
    });
    await flush();

    expect(latest.state.conversation.id).toBe(selectedConversationId);
    expect(latest.state.pendingContext).toEqual(
      createContextAttachment(context, contribution),
    );
    expect(onLaunchConsumed).toHaveBeenCalledWith(1);
  });

  it('keeps a user-selected new conversation instead of restoring history by context', async () => {
    const context = { target: { scope: 'current-page' } };
    const historyStore = createMemoryHistory();
    const contribution = createContribution();
    render({ historyStore });
    await flush();

    act(() =>
      latest.actions.submit(
        '旧会话中的问题',
        createContextAttachment(context, contribution),
      ),
    );
    await flush();
    emit({
      type: 'task-completed',
      snapshot: task('task-1', 'completed', {
        answer: '旧会话中的回答',
        providerId: 'codex',
        modelId: 'gpt',
      }),
    });
    await flush();
    const previousConversationId = latest.state.conversation.id;

    act(() => latest.actions.startNew());
    const selectedConversationId = latest.state.conversation.id;
    expect(selectedConversationId).not.toBe(previousConversationId);

    render({
      historyStore,
      launchRequest: createContextLaunch(
        context,
        { id: 1 },
        contribution,
      ),
    });
    await flush();

    expect(latest.state.conversation.id).toBe(selectedConversationId);
    expect(latest.state.pendingContext).toEqual(
      createContextAttachment(context, contribution),
    );
  });

  it('does not reload history when the persistence reporter identity changes', async () => {
    const historyStore = createMemoryHistory();

    render({
      historyStore,
      onPersistenceError: vi.fn(),
    });
    await flush();
    expect(historyStore.list).toHaveBeenCalledTimes(1);
    expect(latest.state.historyLoading).toBe(false);

    render({
      historyStore,
      onPersistenceError: vi.fn(),
    });
    await flush();
    expect(historyStore.list).toHaveBeenCalledTimes(1);
    expect(latest.state.historyLoading).toBe(false);
  });

  it('deletes the current saved conversation without saving it again', async () => {
    const saved: ConversationRecord = {
      id: 'saved-conversation',
      modeId: 'project.general',
      title: '待删除对话',
      messages: [
        { id: 'q', role: 'user', text: '旧问题', createdTime: 1 },
        { id: 'a', role: 'assistant', text: '旧回答', createdTime: 2 },
      ],
      createdTime: 1,
      updatedTime: 2,
    };
    const historyStore = createMemoryHistory([saved]);
    render({ historyStore });
    await flush();

    act(() => latest.actions.restore(saved));
    act(() => latest.actions.remove(saved));
    await flush();

    expect(historyStore.remove).toHaveBeenCalledOnce();
    expect(historyStore.remove).toHaveBeenCalledWith(saved.id);
    expect(historyStore.save).not.toHaveBeenCalled();
    expect(latest.state.history).toEqual([]);
    expect(latest.state.conversation.id).not.toBe(saved.id);
  });

  it('serializes a delete behind an in-flight save and ignores duplicate deletes', async () => {
    let saveCount = 0;
    let resolveFinalSave!: (records: readonly ConversationRecord[]) => void;
    const historyStore: ConversationHistoryStore = {
      list: vi.fn(async () => []),
      save: vi.fn((record) => {
        saveCount += 1;
        if (saveCount === 1) return Promise.resolve([record]);
        return new Promise<readonly ConversationRecord[]>((resolve) => {
          resolveFinalSave = resolve;
        });
      }),
      remove: vi.fn(async () => []),
    };
    render({ historyStore });

    act(() => latest.actions.submit('问题'));
    await flush();
    emit({
      type: 'task-completed',
      snapshot: task('task-1', 'completed', {
        answer: '最终回答',
        providerId: 'codex',
        modelId: 'gpt',
      }),
    });
    await flush();
    expect(historyStore.save).toHaveBeenCalledTimes(2);

    const completed = latest.state.conversation;
    act(() => latest.actions.remove(completed));
    act(() => latest.actions.remove(completed));
    expect(historyStore.remove).not.toHaveBeenCalled();

    await act(async () => {
      resolveFinalSave([completed]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(historyStore.remove).toHaveBeenCalledOnce();
    expect(historyStore.remove).toHaveBeenCalledWith(completed.id);
    expect(latest.state.history).toEqual([]);
    expect(latest.state.conversation.id).not.toBe(completed.id);
  });

  it('restores an optimistically removed history item when deletion fails and allows retry', async () => {
    const saved: ConversationRecord = {
      id: 'saved-conversation',
      modeId: 'project.general',
      title: '可重试删除',
      messages: [
        { id: 'q', role: 'user', text: '旧问题', createdTime: 1 },
        { id: 'a', role: 'assistant', text: '旧回答', createdTime: 2 },
      ],
      createdTime: 1,
      updatedTime: 2,
    };
    const historyStore: ConversationHistoryStore = {
      list: vi.fn(async () => [saved]),
      save: vi.fn(async (record) => [record]),
      remove: vi.fn()
        .mockRejectedValueOnce(new Error('remove failed'))
        .mockResolvedValueOnce([]),
    };
    render({ historyStore });
    await flush();
    act(() => latest.actions.restore(saved));

    act(() => latest.actions.remove(saved));
    expect(latest.state.history).toEqual([]);
    await flush();
    expect(latest.state.history).toContainEqual(saved);
    expect(latest.state.error?.message).toBe('无法删除对话记录，请稍后重试。');

    act(() => latest.actions.remove(saved));
    await flush();
    expect(historyStore.remove).toHaveBeenCalledTimes(2);
    expect(latest.state.history).toEqual([]);
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
