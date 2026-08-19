import { describe, expect, it } from 'vitest';

import { projectImageExplanationGenerationEvent } from './image-explanation-runtime';

describe('image explanation runtime projection', () => {
  it('streams only events for the tracked image explanation task', () => {
    const tracked = new Set(['task-1']);
    const next = projectImageExplanationGenerationEvent(
      {},
      {
        type: 'execution-event',
        projectId: 'project-1',
        taskId: 'task-1',
        event: { type: 'assistant-delta', delta: '先看整图，再看选区。' },
      },
      'project-1',
      tracked,
    );
    expect(next['task-1']).toMatchObject({
      text: '先看整图，再看选区。',
      phase: 'answering',
    });
    expect(projectImageExplanationGenerationEvent(next, {
      type: 'execution-event', projectId: 'other', taskId: 'task-1',
      event: { type: 'assistant-delta', delta: 'ignored' },
    }, 'project-1', tracked)).toBe(next);
  });

  it('never retains more text than conversation history can persist', () => {
    const next = projectImageExplanationGenerationEvent(
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
