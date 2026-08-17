import { describe, expect, it } from 'vitest';

import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
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
            rect: { x: 10, y: 20, width: 80, height: 18 },
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
    expect(
      isKnownWorkbenchFacilityEvent(
        {
          sessionId: 'session-1',
          facilityId: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
          facilityVersion: CORE_FACILITY_VERSION,
          payload: {
            text: '选区',
            rect: { x: 10, y: 20, width: -1, height: 18 },
          },
        },
        registry,
      ),
    ).toBe(false);
  });

  it('rejects unsafe context menu URLs and coordinates', () => {
    const registry =
      createCoreWorkbenchFacilityDefinitionRegistry();
    const validEvent = {
      sessionId: 'session-1',
      facilityId: CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
      facilityVersion: CORE_FACILITY_VERSION,
      payload: {
        x: 20,
        y: 30,
        frameUrl: 'learning-content://resource/token',
        linkUrl: 'https://example.com/chapter',
        mediaType: 'none',
      },
    };

    expect(
      isKnownWorkbenchFacilityEvent(validEvent, registry),
    ).toBe(true);
    expect(
      isKnownWorkbenchFacilityEvent(
        {
          ...validEvent,
          payload: {
            ...validEvent.payload,
            x: -1,
            linkUrl: 'javascript:alert(1)',
          },
        },
        registry,
      ),
    ).toBe(false);
  });
});
