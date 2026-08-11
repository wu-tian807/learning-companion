// @vitest-environment jsdom
/**
 * 生命周期测试：conversation state machine（useConversationController）。
 *
 * 用 createRoot + act 驱动真实 React effects，覆盖 review 点名的任务订阅
 * 与生命周期竞态——这是 renderToStaticMarkup（不执行 effects）测不到的。
 * 通过注入 onAsk / store / 事件订阅 mock 复现：
 *   - 完成事件早于 start IPC 返回；
 *   - 有 delta → 最终 result 校正且不重复；
 *   - 取消发生在 taskId 返回前后；
 *   - 同一 conversation 连续任务继承 Session；
 *   - 恢复历史后继续原 conversationId。
 */
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React 19 要求显式声明 act 环境，否则 effects 不执行
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type {
  GenerationTaskEvent,
  GenerationTaskView,
} from '../../../shared/generation-tasks';
import type { HtmlConversationStore } from './conversation-store';
import type { HtmlConversationEntry } from './conversation-protocol';
import {
  useConversationController,
  type ConversationControllerActions,
  type ConversationControllerInput,
  type ConversationControllerState,
} from './conversation-controller';

interface WindowWithApi {
  learningCompanion: {
    onGenerationTaskChanged(
      listener: (event: GenerationTaskEvent) => void,
    ): () => void;
  };
}

const listeners = new Set<(event: GenerationTaskEvent) => void>();
const windowWithApi = window as unknown as WindowWithApi;

function emit(event: GenerationTaskEvent): void {
  for (const listener of [...listeners]) {
    listener(event);
  }
}

function snapshot(partial: Partial<GenerationTaskView>): GenerationTaskView {
  return Object.freeze({
    id: 'task-1',
    projectId: 'project-1',
    definitionId: 'html.assistant',
    definitionVersion: 1,
    status: 'processing',
    metrics: Object.freeze({}),
    createdTime: 100,
    updatedTime: 100,
    ...partial,
  });
}

function completedSnapshot(answer: string, updatedTime = 200): GenerationTaskView {
  return snapshot({
    status: 'completed',
    result: Object.freeze({ answer }),
    updatedTime,
  });
}

/** 测试用 harness：把 controller 的 state/actions 暴露给测试断言。 */
function Harness({
  input,
  onRender,
}: {
  readonly input: ConversationControllerInput;
  readonly onRender: (value: {
    readonly state: ConversationControllerState;
    readonly actions: ConversationControllerActions;
  }) => void;
}) {
  const value = useConversationController(input);
  onRender(value);
  return null;
}

describe('useConversationController 生命周期', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let onRender: (value: {
    state: ConversationControllerState;
    actions: ConversationControllerActions;
  }) => void;
  let latest: {
    state: ConversationControllerState;
    actions: ConversationControllerActions;
  };
  let createIdCounter = 0;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    listeners.clear();
    windowWithApi.learningCompanion = {
      onGenerationTaskChanged(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    onRender = vi.fn((value: {
      state: ConversationControllerState;
      actions: ConversationControllerActions;
    }) => {
      latest = value;
    });
    createIdCounter = 0;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root!.unmount();
      });
      root = undefined;
    }
    container?.remove();
    listeners.clear();
  });

  function renderController(
    input: Omit<
      ConversationControllerInput,
      'onClose' | 'onAsk'
    > &
      Partial<Pick<ConversationControllerInput, 'onClose' | 'onAsk'>>,
  ) {
    root = createRoot(container!);
    act(() => {
      root!.render(
        <Harness
          input={
            {
              ...input,
              onClose:
                input.onClose ??
                vi.fn(() => {
                  /* 默认无操作 */
                }),
              onAsk:
                input.onAsk ??
                vi.fn(async () => undefined),
            } as ConversationControllerInput
          }
          onRender={(value) => onRender(value)}
        />,
      );
    });
    return latest;
  }

  function storeWith(entries: readonly HtmlConversationEntry[] = []) {
    const store: HtmlConversationStore = {
      list: vi.fn(async () => entries),
      save: vi.fn(async () => entries),
      remove: vi.fn(async () => entries),
    };
    return store;
  }

  it('完成事件早于 start IPC 返回：最终回答仍显示且 busy 正常结束', async () => {
    let resolveAsk: (value: {
      taskId: string;
      snapshot?: GenerationTaskView;
    } | undefined) => void = () => undefined;
    const askPromise = new Promise<
      { taskId: string; snapshot?: GenerationTaskView } | undefined
    >((resolve) => {
      resolveAsk = resolve;
    });
    const onAsk = vi.fn(async () => askPromise);
    const savedEntries: HtmlConversationEntry[] = [];
    const store = storeWith();
    store.save = vi.fn(async (entry) => {
      savedEntries.push(entry);
      return [entry];
    });
    renderController({
      open: true,
      store,
      onAsk,
      options: { createId: () => `id-${++createIdCounter}`, now: () => 100 },
    });

    // 提交问题 → onAsk 挂起（start IPC 未返回）
    act(() => {
      latest.actions.submitQuestion('什么是自注意力？');
    });
    expect(latest.state.busy).toBe(true);
    expect(latest.state.messages).toHaveLength(2);
    expect(latest.state.messages[1]).toMatchObject({
      role: 'assistant',
      text: '',
      streaming: true,
    });

    // start 返回前，完成事件先到（快 task 场景）
    act(() => {
      emit({ type: 'task-completed', snapshot: completedSnapshot('最终回答') });
    });

    // start 返回（带权威快照）
    await act(async () => {
      resolveAsk({ taskId: 'task-1', snapshot: completedSnapshot('最终回答') });
      await askPromise;
    });

    expect(latest.state.messages[1]).toMatchObject({
      role: 'assistant',
      text: '最终回答',
    });
    expect(latest.state.messages[1]).toMatchObject({
      generationTaskId: 'task-1',
    });
    expect(savedEntries[0]?.messages[1]).toMatchObject({
      role: 'assistant',
      text: '',
      generationTaskId: 'task-1',
    });
    expect(latest.state.messages[1]?.streaming).toBeFalsy();
    expect(latest.state.busy).toBe(false);
  });

  it('有 delta 时最终 result 校正流式缓冲且不重复', async () => {
    let resolveAsk: (value: {
      taskId: string;
      snapshot?: GenerationTaskView;
    } | undefined) => void = () => undefined;
    const askPromise = new Promise<
      { taskId: string; snapshot?: GenerationTaskView } | undefined
    >((resolve) => {
      resolveAsk = resolve;
    });
    const onAsk = vi.fn(async () => askPromise);
    renderController({
      open: true,
      store: storeWith(),
      onAsk,
      options: { createId: () => `id-${++createIdCounter}`, now: () => 100 },
    });

    act(() => {
      latest.actions.submitQuestion('解释一下？');
    });

    // start 返回（running 快照）→ taskId 注册，之后的 delta 才被接收
    await act(async () => {
      resolveAsk({ taskId: 'task-1', snapshot: snapshot({ status: 'processing' }) });
      await askPromise;
    });

    // delta 逐字到达（真实流式）
    act(() => {
      emit({
        type: 'execution-event',
        projectId: 'project-1',
        taskId: 'task-1',
        event: { type: 'assistant-delta', delta: '你' },
      });
      emit({
        type: 'execution-event',
        projectId: 'project-1',
        taskId: 'task-1',
        event: { type: 'assistant-delta', delta: '好' },
      });
    });
    expect(latest.state.messages[1]?.text).toBe('你好');

    // 完成事件带最终 result（校正流式缓冲，不叠加造成重复）
    act(() => {
      emit({ type: 'task-completed', snapshot: completedSnapshot('你好') });
    });

    // 最终结果 = result.answer（不叠加 delta 造成重复）
    expect(latest.state.messages[1]?.text).toBe('你好');
    expect(latest.state.messages[1]?.streaming).toBeFalsy();
    expect(latest.state.busy).toBe(false);
  });

  it('取消发生在 taskId 返回后：保留已生成部分并标记 stopped', async () => {
    let resolveAsk: (value: {
      taskId: string;
      snapshot?: GenerationTaskView;
    } | undefined) => void = () => undefined;
    const askPromise = new Promise<
      { taskId: string; snapshot?: GenerationTaskView } | undefined
    >((resolve) => {
      resolveAsk = resolve;
    });
    const onAsk = vi.fn(async () => askPromise);
    const onCancelAnswer = vi.fn();
    renderController({
      open: true,
      store: storeWith(),
      onAsk,
      onCancelAnswer,
      options: { createId: () => `id-${++createIdCounter}`, now: () => 100 },
    });

    act(() => {
      latest.actions.submitQuestion('会被取消吗？');
    });

    // start 返回，再广播 cancelled
    await act(async () => {
      resolveAsk({ taskId: 'task-1', snapshot: snapshot({ status: 'processing' }) });
      await askPromise;
    });
    act(() => {
      emit({ type: 'task-changed', snapshot: snapshot({ status: 'cancelled' }) });
    });

    expect(latest.state.messages).toHaveLength(2);
    expect(latest.state.messages[0]).toMatchObject({
      role: 'user',
      text: '会被取消吗？',
    });
    expect(latest.state.messages[1]).toMatchObject({
      role: 'assistant',
      streaming: false,
      stopped: true,
    });
    expect(latest.state.busy).toBe(false);
    expect(onCancelAnswer).not.toHaveBeenCalled();
  });

  it('终态时同步回调 onAnswerSettled（完成/失败/取消各一次）', async () => {
    const onAnswerSettled = vi.fn();
    const onAsk = vi.fn(async () => ({
      taskId: 'task-1',
      snapshot: snapshot({ status: 'processing' }),
    }));
    renderController({
      open: true,
      store: storeWith(),
      onAsk,
      onAnswerSettled,
      options: { createId: () => `id-${++createIdCounter}`, now: () => 100 },
    });

    act(() => {
      latest.actions.submitQuestion('第一问');
    });
    await act(async () => {
      await Promise.resolve();
    });
    // 广播完成 → 终态回调
    act(() => {
      emit({ type: 'task-completed', snapshot: completedSnapshot('完成', 200) });
    });
    expect(onAnswerSettled).toHaveBeenCalledWith('task-1');
    expect(onAnswerSettled).toHaveBeenCalledTimes(1);
    expect(latest.state.busy).toBe(false);

    // 再提交第二问 → 取消终态 → 第二次回调
    act(() => {
      latest.actions.submitQuestion('第二问');
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      emit({ type: 'task-changed', snapshot: snapshot({ status: 'cancelled' }) });
    });
    expect(onAnswerSettled).toHaveBeenCalledTimes(2);
    expect(onAnswerSettled).toHaveBeenLastCalledWith('task-1');
  });

  it('handleCancelAnswer 携带进行中的任务 id；busy 结束后不再回调', async () => {
    const onCancelAnswer = vi.fn();
    const onAsk = vi.fn(async () => ({
      taskId: 'task-1',
      snapshot: snapshot({ status: 'processing' }),
    }));
    renderController({
      open: true,
      store: storeWith(),
      onAsk,
      onCancelAnswer,
      options: { createId: () => `id-${++createIdCounter}`, now: () => 100 },
    });

    // 提交 → 取消（busy 中）→ 取消回调携带 taskId
    act(() => {
      latest.actions.submitQuestion('取消目标');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest.state.busy).toBe(true);
    act(() => {
      latest.actions.handleCancelAnswer();
    });
    expect(onCancelAnswer).toHaveBeenCalledWith('task-1');

    // 任务终态（busy 结束）后再点停止：不再回调
    act(() => {
      emit({ type: 'task-completed', snapshot: completedSnapshot('最终', 200) });
    });
    expect(latest.state.busy).toBe(false);
    act(() => {
      latest.actions.handleCancelAnswer();
    });
    expect(onCancelAnswer).toHaveBeenCalledTimes(1);
  });

  it('返回前点击停止会在 start 完成后取消真实任务', async () => {
    let resolveAsk: (value: {
      taskId: string;
      snapshot?: GenerationTaskView;
    }) => void = () => undefined;
    const askPromise = new Promise<{
      taskId: string;
      snapshot?: GenerationTaskView;
    }>((resolve) => {
      resolveAsk = resolve;
    });
    const onCancelAnswer = vi.fn();
    renderController({
      open: true,
      store: storeWith(),
      onAsk: vi.fn(async () => askPromise),
      onCancelAnswer,
      options: { createId: () => `id-${++createIdCounter}`, now: () => 100 },
    });

    act(() => {
      latest.actions.submitQuestion('未返回时停止');
      latest.actions.handleCancelAnswer();
    });
    expect(onCancelAnswer).not.toHaveBeenCalled();

    await act(async () => {
      resolveAsk({ taskId: 'task-1', snapshot: snapshot({ status: 'processing' }) });
      await askPromise;
    });
    expect(onCancelAnswer).toHaveBeenCalledWith('task-1');
  });
  it('取消发生在 taskId 返回前：校准快照为 cancelled 时同样保留并标记 stopped', async () => {
    let resolveAsk: (value: {
      taskId: string;
      snapshot?: GenerationTaskView;
    } | undefined) => void = () => undefined;
    const askPromise = new Promise<
      { taskId: string; snapshot?: GenerationTaskView } | undefined
    >((resolve) => {
      resolveAsk = resolve;
    });
    const onAsk = vi.fn(async () => askPromise);
    renderController({
      open: true,
      store: storeWith(),
      onAsk,
      options: { createId: () => `id-${++createIdCounter}`, now: () => 100 },
    });

    act(() => {
      latest.actions.submitQuestion('也会取消吗？');
    });

    // start 返回时快照已是 cancelled（取消广播早到，start 读到终态）
    await act(async () => {
      resolveAsk({ taskId: 'task-1', snapshot: snapshot({ status: 'cancelled' }) });
      await askPromise;
    });

    expect(latest.state.messages).toHaveLength(2);
    expect(latest.state.messages[0]?.text).toBe('也会取消吗？');
    expect(latest.state.messages[1]).toMatchObject({
      role: 'assistant',
      streaming: false,
      stopped: true,
    });
    expect(latest.state.busy).toBe(false);
  });

  it('任务快速失败（terminal-failed）后重试重跑原任务，不填充输入框', async () => {
    const onAsk = vi.fn(async () => ({
      taskId: 'task-1',
      snapshot: snapshot({ status: 'failed' }),
    }));
    const onRetryTask = vi.fn(async () => ({
      taskId: 'task-1',
      snapshot: snapshot({ status: 'processing' }),
    }));
    renderController({
      open: true,
      store: storeWith(),
      onAsk,
      onRetryTask,
      options: { createId: () => `id-${++createIdCounter}`, now: () => 100 },
    });

    // 提交问题 → 输入框被清空（consumeInput 默认 true）
    act(() => {
      latest.actions.submitQuestion('重试我');
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(latest.state.busy).toBe(false);
    expect(latest.state.errorText).toBe('AI 回答失败，请重试。');
    // 失败后输入框保持空：重试不依赖输入框内容，不该回填旧问题
    expect(latest.state.input).toBe('');

    // 重试：重跑原任务，不重新提问
    act(() => {
      latest.actions.retryTask();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onRetryTask).toHaveBeenCalledWith('task-1');
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(latest.state.busy).toBe(true);
  });

  it('运行中任务经 task-changed 事件失败：重试重跑原任务而非重新提问', async () => {
    const onAsk = vi.fn(async () => ({
      taskId: 'task-1',
      snapshot: snapshot({ status: 'processing' }),
    }));
    const onRetryTask = vi.fn(async () => ({
      taskId: 'task-1',
      snapshot: snapshot({ status: 'processing' }),
    }));
    renderController({
      open: true,
      store: storeWith(),
      onAsk,
      onRetryTask,
      options: { createId: () => `id-${++createIdCounter}`, now: () => 100 },
    });

    act(() => {
      latest.actions.submitQuestion('事件失败问题');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest.state.busy).toBe(true);

    // 真实场景：任务运行中广播 failed 事件（如 401 无 key）
    act(() => {
      emit({
        type: 'task-changed',
        snapshot: snapshot({ status: 'failed' }),
      });
    });

    expect(latest.state.busy).toBe(false);
    expect(latest.state.errorText).toBe('AI 回答失败，请重试。');

    // 重试：重跑原任务（onRetryTask(task-1)），不重新提问（onAsk 不再被调）
    act(() => {
      latest.actions.retryTask();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onRetryTask).toHaveBeenCalledWith('task-1');
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(latest.state.busy).toBe(true);
  });

  it('同一 conversation 连续任务继承同一 conversationId', async () => {
    const conversationIds: string[] = [];
    const onAsk = vi.fn(
      async (conversationId: string) => {
        conversationIds.push(conversationId);
        return {
          taskId: `task-${conversationIds.length}`,
          snapshot: snapshot({ status: 'processing' }),
        };
      },
    );
    renderController({
      open: true,
      store: storeWith(),
      onAsk,
      options: { createId: () => `id-${++createIdCounter}`, now: () => 100 },
    });

    act(() => {
      latest.actions.submitQuestion('第一问');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest.state.busy).toBe(true);

    act(() => {
      emit({
        type: 'task-completed',
        snapshot: completedSnapshot('第一答', 200),
      });
    });
    expect(latest.state.busy).toBe(false);

    act(() => {
      latest.actions.submitQuestion('第二问');
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 两轮共享同一个 conversationId → 同一 named workspace / Codex thread
    expect(conversationIds).toHaveLength(2);
    expect(conversationIds[0]).toBe(conversationIds[1]);
  });

  it('恢复历史会按持久化 taskId 读取最终结果并校正 UI', async () => {
    const entry: HtmlConversationEntry = {
      id: 'conversation-restored',
      messages: [
        { role: 'user', text: '旧问题' },
        {
          role: 'assistant',
          text: '崩溃前的临时文本',
          generationTaskId: 'task-1',
        },
      ],
      createdTime: 1,
      updatedTime: 2,
    };
    const onGetTask = vi.fn(async () => completedSnapshot('重启后最终回答', 300));
    renderController({
      open: true,
      store: storeWith([entry]),
      onGetTask,
      options: {
        createId: () => `id-${++createIdCounter}`,
        createConversationId: () => 'new-conversation',
        now: () => 100,
      },
    });

    act(() => {
      latest.actions.restore(entry);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onGetTask).toHaveBeenCalledWith('task-1');
    expect(latest.state.messages[1]).toMatchObject({
      text: '重启后最终回答',
      generationTaskId: 'task-1',
      streaming: false,
    });
    expect(latest.state.busy).toBe(false);
  });

  it('恢复历史中的运行中任务会恢复 streaming 并注册取消边界', async () => {
    const entry: HtmlConversationEntry = {
      id: 'conversation-restored-running',
      messages: [
        { role: 'user', text: '旧问题' },
        {
          role: 'assistant',
          text: '重启前已生成的临时文本',
          generationTaskId: 'task-running',
        },
      ],
      createdTime: 1,
      updatedTime: 2,
    };
    const onGetTask = vi.fn(async () =>
      snapshot({ id: 'task-running', status: 'processing' }),
    );
    const onTaskActivated = vi.fn();
    renderController({
      open: true,
      store: storeWith([entry]),
      onGetTask,
      onTaskActivated,
      options: {
        createId: () => `id-${++createIdCounter}`,
        createConversationId: () => 'new-conversation',
        now: () => 100,
      },
    });

    act(() => {
      latest.actions.restore(entry);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onGetTask).toHaveBeenCalledWith('task-running');
    expect(onTaskActivated).toHaveBeenCalledWith('task-running');
    expect(latest.state.messages[1]).toMatchObject({
      text: '重启前已生成的临时文本',
      generationTaskId: 'task-running',
      streaming: true,
    });
    expect(latest.state.busy).toBe(true);

    // 恢复后的运行中任务继续消费 delta 与终态广播
    act(() => {
      emit({
        type: 'execution-event',
        projectId: 'project-1',
        taskId: 'task-running',
        event: { type: 'assistant-delta', delta: '继续' },
      });
    });
    expect(latest.state.messages[1]?.text).toBe('重启前已生成的临时文本继续');

    act(() => {
      emit({
        type: 'task-completed',
        snapshot: snapshot({
          id: 'task-running',
          status: 'completed',
          result: Object.freeze({ answer: '最终回答' }),
          updatedTime: 300,
        }),
      });
    });
    expect(latest.state.messages[1]).toMatchObject({
      text: '最终回答',
      streaming: false,
    });
    expect(latest.state.busy).toBe(false);
    expect(latest.state.messages[1]?.generationTaskId).toBe('task-running');
  });
  it('恢复历史后继续使用原 conversationId；新建对话才生成新 ID', async () => {
    const entry: HtmlConversationEntry = Object.freeze({
      id: 'conv-history-1',
      messages: Object.freeze([
        Object.freeze({ role: 'user', text: '历史问题' }),
        Object.freeze({ role: 'assistant', text: '历史回答' }),
      ]),
      createdTime: 50,
      updatedTime: 60,
    });
    const conversationIds: string[] = [];
    const onAsk = vi.fn(
      async (conversationId: string) => {
        conversationIds.push(conversationId);
        return {
          taskId: `task-${conversationIds.length}`,
          snapshot: snapshot({ status: 'processing' }),
        };
      },
    );
    renderController({
      open: true,
      store: storeWith([entry]),
      onAsk,
      options: { createId: () => `id-${++createIdCounter}`, now: () => 100 },
    });

    act(() => {
      latest.actions.restore(entry);
    });
    expect(latest.state.messages).toHaveLength(2);
    expect(latest.state.messages[0]?.text).toBe('历史问题');

    // 恢复后提问 → 用原 conversationId（继续原 Codex thread）
    act(() => {
      latest.actions.submitQuestion('接着问');
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      emit({ type: 'task-completed', snapshot: completedSnapshot('继续答', 200) });
    });
    expect(conversationIds).toHaveLength(1);
    expect(conversationIds[0]).toBe('conv-history-1');
    expect(latest.state.busy).toBe(false);

    // 新建对话 → 新的 conversationId
    act(() => {
      latest.actions.startNew();
    });
    act(() => {
      latest.actions.submitQuestion('新对话问题');
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(conversationIds).toHaveLength(2);
    expect(conversationIds[1]).not.toBe('conv-history-1');
  });
});
