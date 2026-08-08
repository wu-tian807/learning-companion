import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../shared/ipc';
import { subscribeGenerationTaskEvents } from './generation-task-events';

describe('Preload GenerationTask Event subscription', () => {
  it('validates events and removes only its own listener', () => {
    let wrappedListener:
      | ((event: unknown, value: unknown) => void)
      | undefined;
    const ipc = {
      on: vi.fn((_channel, listener) => {
        wrappedListener = listener;
        return ipc;
      }),
      removeListener: vi.fn(() => ipc),
    };
    const listener = vi.fn();
    const dispose = subscribeGenerationTaskEvents(ipc, listener);
    const event = {
      type: 'execution-event',
      projectId: 'project-1',
      taskId: 'task-1',
      event: { type: 'assistant-delta', delta: '正在生成' },
    } as const;

    wrappedListener?.({}, event);
    wrappedListener?.({}, { ...event, taskId: '' });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);

    dispose();
    expect(ipc.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.generationTaskChanged,
      wrappedListener,
    );
  });
});
