import { describe, expect, it } from 'vitest';

import {
  CORE_FACILITY_VERSION,
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
  createCoreWorkbenchFacilityDefinitionRegistry,
} from './core-facilities';
import {
  isKnownWorkbenchFacilityEvent,
  isWorkbenchFacilityEvent,
} from './facility-event';

describe('Workbench Facility Event', () => {
  it('validates the open envelope independently of its payload type', () => {
    expect(
      isWorkbenchFacilityEvent({
        sessionId: 'session-1',
        facilityId: 'test.input.region-selection',
        facilityVersion: 3,
        payload: { x: 0.2, y: 0.3 },
      }),
    ).toBe(true);
  });

  it('uses the facility registry to validate a concrete event payload', () => {
    const registry =
      createCoreWorkbenchFacilityDefinitionRegistry();

    expect(
      isKnownWorkbenchFacilityEvent(
        {
          sessionId: 'session-1',
          facilityId: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
          facilityVersion: CORE_FACILITY_VERSION,
          payload: {
            text: '选区',
            frameUrl: 'learning-content://resource/token',
          },
        },
        registry,
      ),
    ).toBe(true);
    expect(
      isKnownWorkbenchFacilityEvent(
        {
          sessionId: 'session-1',
          facilityId: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
          facilityVersion: CORE_FACILITY_VERSION,
          payload: { text: 42 },
        },
        registry,
      ),
    ).toBe(false);
  });
});
