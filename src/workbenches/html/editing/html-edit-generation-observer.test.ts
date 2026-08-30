import { describe, expect, it, vi } from 'vitest';

import type {
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
  GenerationTaskServiceListener,
} from '../../../main/generation/generation-task-service';
import { HtmlEditGenerationObserver } from './html-edit-generation-observer';

function harness() {
  let listener: GenerationTaskServiceListener | undefined;
  const unsubscribe = vi.fn();
  const tasks = {
    subscribe: vi.fn((next: GenerationTaskServiceListener) => {
      listener = next;
      return unsubscribe;
    }),
  } as unknown as GenerationTaskServiceApi;
  const lifecycle = {
    handleTaskSnapshot: vi.fn(async () => undefined),
    handleTaskDiscarded: vi.fn(async () => undefined),
  };
  const logger = { error: vi.fn() };
  const observer = new HtmlEditGenerationObserver(tasks, lifecycle, logger);
  const publish = (event: GenerationTaskServiceEvent) => listener?.(event);
  return { lifecycle, logger, observer, publish, unsubscribe };
}

function snapshot(terminal: 'completed' | 'failed' | 'cancelled' | 'active') {
  return {
    id: 'task-1',
    projectId: 'project-1',
    agentCalls: [],
    ...(terminal === 'completed'
      ? { completed: { completedTime: 2, result: {} } }
      : {}),
    ...(terminal === 'failed'
      ? { failure: { phase: 'process', failedTime: 2, message: 'failed' } }
      : {}),
    ...(terminal === 'cancelled' ? { cancelledTime: 2 } : {}),
  } as never;
}

describe('HtmlEditGenerationObserver', () => {
  it.each(['completed', 'failed', 'cancelled'] as const)(
    'forwards a %s terminal snapshot',
    async (terminal) => {
      const { lifecycle, observer, publish } = harness();
      const value = snapshot(terminal);

      publish({ type: 'task-changed', snapshot: value });
      await observer.drain();

      expect(lifecycle.handleTaskSnapshot).toHaveBeenCalledWith(value);
    },
  );

  it('ignores active snapshots and forwards discarded tasks', async () => {
    const { lifecycle, observer, publish } = harness();

    publish({ type: 'task-changed', snapshot: snapshot('active') });
    publish({
      type: 'task-discarded',
      projectId: 'project-1',
      taskId: 'task-1',
    });
    await observer.drain();

    expect(lifecycle.handleTaskSnapshot).not.toHaveBeenCalled();
    expect(lifecycle.handleTaskDiscarded).toHaveBeenCalledWith(
      'project-1',
      'task-1',
    );
  });

  it('keeps duplicate terminal delivery safe for the idempotent lifecycle', async () => {
    const { lifecycle, observer, publish } = harness();
    const value = snapshot('completed');

    publish({ type: 'task-changed', snapshot: value });
    publish({ type: 'task-completed', snapshot: value, result: {} as never });
    await observer.drain();

    expect(lifecycle.handleTaskSnapshot).toHaveBeenCalledTimes(2);
  });

  it('stops accepting events after dispose while accepted work can drain', async () => {
    const { lifecycle, observer, publish, unsubscribe } = harness();
    publish({ type: 'task-changed', snapshot: snapshot('completed') });

    observer.dispose();
    publish({ type: 'task-changed', snapshot: snapshot('failed') });
    await observer.drain();

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(lifecycle.handleTaskSnapshot).toHaveBeenCalledOnce();
  });

  it('reports lifecycle failures without creating an unhandled rejection', async () => {
    const { lifecycle, logger, observer, publish } = harness();
    lifecycle.handleTaskSnapshot.mockRejectedValueOnce(new Error('broken'));

    publish({ type: 'task-changed', snapshot: snapshot('failed') });
    await observer.drain();

    expect(logger.error).toHaveBeenCalledWith(
      '[html-editing] GenerationTask 收口失败',
      expect.any(Error),
    );
  });
});
