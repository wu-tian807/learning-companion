import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../shared/ipc';
import {
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
} from '../shared/workbench/facilities/core-facilities';
import { subscribeWorkbenchFacilityEvents } from './workbench-facility-events';

describe('Preload Workbench Facility Event subscription', () => {
  it('validates events and removes exactly its own listener', () => {
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
    const dispose = subscribeWorkbenchFacilityEvents(
      ipc,
      listener,
    );
    const validEvent = {
      sessionId: 'session-1',
      facilityId: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
      facilityVersion: 1,
      payload: { text: '选区' },
    };

    wrappedListener?.({}, validEvent);
    wrappedListener?.({}, {
      ...validEvent,
      payload: { text: 42 },
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(validEvent);

    dispose();
    expect(ipc.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.workbenchFacilityEvent,
      wrappedListener,
    );
  });
});
