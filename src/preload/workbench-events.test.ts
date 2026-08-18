import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../shared/ipc';
import { subscribeWorkbenchEvents } from './workbench-events';

describe('Preload Workbench Event subscription', () => {
  it('forwards only validated events and removes its own listener', () => {
    let wrapped: ((event: unknown, value: unknown) => void) | undefined;
    const ipc = {
      on: vi.fn((_channel, listener) => {
        wrapped = listener;
        return ipc;
      }),
      removeListener: vi.fn(() => ipc),
    };
    const listener = vi.fn();
    const dispose = subscribeWorkbenchEvents(ipc, listener);
    const event = {
      sessionId: 'session',
      type: 'test:status',
      payload: { phase: 'ready' },
    };

    wrapped?.({}, event);
    wrapped?.({}, { ...event, payload: Number.NaN });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);

    dispose();
    expect(ipc.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.workbenchEvent,
      wrapped,
    );
  });
});
