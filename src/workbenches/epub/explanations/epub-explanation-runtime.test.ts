import { describe, expect, it } from 'vitest';

import {
  applyEpubExplanationRuntimeEvent,
  projectEpubExplanationGenerationEvent,
  reduceEpubExplanationRuntime,
  removeEpubExplanationRuntime,
} from './epub-explanation-runtime';

describe('EPUB explanation runtime projection', () => {
  it('appends real deltas and lets the completed snapshot correct missing text', () => {
    const first = reduceEpubExplanationRuntime(undefined, {
      type: 'assistant-delta',
      delta: '第一段',
    });
    const second = reduceEpubExplanationRuntime(first, {
      type: 'assistant-delta',
      delta: '内容',
    });
    const completed = reduceEpubExplanationRuntime(second, {
      type: 'assistant-completed',
      text: '第一段完整内容',
    });

    expect(second).toMatchObject({
      text: '第一段内容',
      phase: 'answering',
    });
    expect(completed).toEqual({
      text: '第一段完整内容',
      phase: 'saving',
      statusMessage: '回答已生成，正在保存解释…',
    });
  });

  it('keeps simultaneous explanation tasks isolated and removes only the requested task', () => {
    let state = applyEpubExplanationRuntimeEvent({}, 'task-1', {
      type: 'assistant-delta',
      delta: '任务一',
    });
    state = applyEpubExplanationRuntimeEvent(state, 'task-2', {
      type: 'assistant-delta',
      delta: '任务二',
    });

    expect(state['task-1']?.text).toBe('任务一');
    expect(state['task-2']?.text).toBe('任务二');
    expect(removeEpubExplanationRuntime(state, 'task-1')).toEqual({
      'task-2': expect.objectContaining({ text: '任务二' }),
    });
  });

  it('shows useful status without inventing text for a provider that has not emitted a delta', () => {
    const status = reduceEpubExplanationRuntime(undefined, {
      type: 'status',
      message: '正在连接 Agent…',
    });
    const unchanged = reduceEpubExplanationRuntime(status, {
      type: 'usage-updated',
      usage: { outputTokens: 3 },
    });

    expect(status).toEqual({
      text: '',
      phase: 'waiting',
      statusMessage: '正在连接 Agent…',
    });
    expect(unchanged).toBe(status);
  });

  it('bounds transient text retained from untrusted runtime events', () => {
    const runtime = reduceEpubExplanationRuntime(undefined, {
      type: 'assistant-completed',
      text: 'x'.repeat(70_000),
    });

    expect(runtime?.text).toHaveLength(64_000);
  });

  it('projects only tracked tasks from the active Project and clears cancellation', () => {
    const tracked = new Set(['task-1']);
    const accepted = projectEpubExplanationGenerationEvent(
      {},
      {
        type: 'execution-event',
        projectId: 'project-1',
        taskId: 'task-1',
        event: { type: 'assistant-delta', delta: '当前项目' },
      },
      'project-1',
      tracked,
    );
    const otherProject = projectEpubExplanationGenerationEvent(
      accepted,
      {
        type: 'execution-event',
        projectId: 'project-2',
        taskId: 'task-1',
        event: { type: 'assistant-delta', delta: '不应串入' },
      },
      'project-1',
      tracked,
    );
    const untrackedTask = projectEpubExplanationGenerationEvent(
      accepted,
      {
        type: 'execution-event',
        projectId: 'project-1',
        taskId: 'task-2',
        event: { type: 'assistant-delta', delta: '不应串入' },
      },
      'project-1',
      tracked,
    );
    const cancelled = projectEpubExplanationGenerationEvent(
      accepted,
      {
        type: 'task-changed',
        snapshot: {
          id: 'task-1',
          projectId: 'project-1',
          definitionId: 'epub.ai-explanation',
          definitionVersion: 1,
          status: 'cancelled',
          metrics: {},
          createdTime: 1,
          updatedTime: 2,
        },
      },
      'project-1',
      tracked,
    );

    expect(accepted['task-1']?.text).toBe('当前项目');
    expect(otherProject).toBe(accepted);
    expect(untrackedTask).toBe(accepted);
    expect(cancelled).toEqual({});
  });
});
