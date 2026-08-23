import { describe, expect, it } from 'vitest';

import { projectVideoExplanationGenerationEvent } from './video-explanation-runtime';

describe('video explanation runtime projection', () => {
  it('streams only the tracked task in the active project', () => {
    const tracked = new Set(['task-1']);
    const next = projectVideoExplanationGenerationEvent(
      {},
      {
        type: 'execution-event',
        projectId: 'project-1',
        taskId: 'task-1',
        event: { type: 'assistant-delta', delta: '正在分析画面。' },
      },
      'project-1',
      tracked,
    );
    expect(next['task-1']).toMatchObject({
      text: '正在分析画面。',
      phase: 'answering',
    });
    expect(
      projectVideoExplanationGenerationEvent(
        next,
        {
          type: 'execution-event',
          projectId: 'project-2',
          taskId: 'task-1',
          event: { type: 'assistant-delta', delta: '忽略' },
        },
        'project-1',
        tracked,
      ),
    ).toBe(next);
  });

  it('caps streamed text at the persisted answer boundary', () => {
    const next = projectVideoExplanationGenerationEvent(
      {},
      {
        type: 'execution-event',
        projectId: 'project-1',
        taskId: 'task-1',
        event: { type: 'assistant-completed', text: 'x'.repeat(70_000) },
      },
      'project-1',
      new Set(['task-1']),
    );
    expect(next['task-1']?.text).toHaveLength(32_768);
  });
});
