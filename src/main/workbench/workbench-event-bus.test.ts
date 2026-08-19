import { describe, expect, it, vi } from 'vitest';

import { WorkbenchEventBus } from './workbench-event-bus';

describe('WorkbenchEventBus', () => {
  it('publishes valid events and supports disposal', () => {
    const bus = new WorkbenchEventBus();
    const listener = vi.fn();
    const dispose = bus.subscribe(listener);
    const event = {
      sessionId: 'session',
      type: 'test:status',
      payload: { phase: 'ready' },
    };

    bus.publish(event);
    dispose();
    bus.publish(event);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('rejects malformed events', () => {
    const bus = new WorkbenchEventBus();
    expect(() =>
      bus.publish({
        sessionId: '',
        type: 'event',
        payload: null,
      }),
    ).toThrow('DATA_INTEGRITY_ERROR');
  });
});
