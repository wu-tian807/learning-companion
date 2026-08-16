import { describe, expect, it } from 'vitest';

import {
  resolveConversationTask,
  type ConversationTaskResolution,
} from './conversation-task-resolution';

const baseSnapshot = {
  id: 'task-1',
  projectId: 'project-1',
  definitionId: 'html.assistant',
  definitionVersion: 1,
  status: 'created',
  metrics: {},
  createdTime: 10,
  updatedTime: 10,
};

function snapshot(
  overrides: Partial<typeof baseSnapshot> & {
    readonly status: string;
    readonly result?: unknown;
  },
) {
  return {
    ...baseSnapshot,
    ...overrides,
  } as Parameters<typeof resolveConversationTask>[1];
}

describe('resolveConversationTask', () => {
  it('returns running when the snapshot is missing or belongs to another task', () => {
    expect(
      resolveConversationTask('task-1', undefined),
    ).toEqual({ kind: 'running' });
    expect(
      resolveConversationTask('task-1', snapshot({ id: 'task-2', status: 'completed' })),
    ).toEqual({ kind: 'running' });
  });

  it('resolves an early completion with the authoritative answer', () => {
    const resolution = resolveConversationTask(
      'task-1',
      snapshot({
        status: 'completed',
        updatedTime: 20,
        result: { answer: '最终回答' },
      }),
    );
    expect(resolution).toEqual({
      kind: 'terminal-completed',
      answer: '最终回答',
      updatedTime: 20,
    });
  });

  it('treats a completed task without a valid answer as failed', () => {
    const resolution = resolveConversationTask(
      'task-1',
      snapshot({
        status: 'completed',
        result: { answer: '' },
      }),
    ) as ConversationTaskResolution;
    expect(resolution.kind).toBe('terminal-failed');
  });

  it('treats cancelled and failed as terminal without an answer', () => {
    expect(
      resolveConversationTask(
        'task-1',
        snapshot({ status: 'cancelled' }),
      ),
    ).toEqual({ kind: 'terminal-cancelled' });
    expect(
      resolveConversationTask('task-1', snapshot({ status: 'failed' })),
    ).toEqual({ kind: 'terminal-failed' });
  });

  it('keeps waiting for running states', () => {
    for (const status of ['created', 'prepared', 'processing']) {
      expect(
        resolveConversationTask(
          'task-1',
          snapshot({ status }),
        ),
      ).toEqual({ kind: 'running' });
    }
  });
});
