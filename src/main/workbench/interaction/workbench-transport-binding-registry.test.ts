import { describe, expect, it, vi } from 'vitest';

import {
  CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
  CORE_FACILITY_VERSION,
  CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
  createCoreWorkbenchFacilityDefinitionRegistry,
} from '../../../shared/workbench/facilities/core-facilities';
import type { WorkbenchTransportBinding } from '../../../shared/workbench/facilities/transport-binding';
import { htmlWorkbenchManifest } from '../../../workbenches/html/shared';
import { WorkbenchTransportBindingRegistry } from './workbench-transport-binding-registry';

function sandboxBinding(
  rootUrl = 'learning-content://resource/token',
): WorkbenchTransportBinding {
  return {
    transportId: CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
    transportVersion: CORE_FACILITY_VERSION,
    facilities: [
      {
        id: CORE_CONTEXT_MENU_SURFACE_FACILITY_ID,
        version: CORE_FACILITY_VERSION,
      },
      {
        id: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        version: CORE_FACILITY_VERSION,
      },
    ],
    payload: { rootUrl },
  };
}

describe('WorkbenchTransportBindingRegistry', () => {
  it('registers and idempotently disposes session bindings', () => {
    const registry = new WorkbenchTransportBindingRegistry(
      createCoreWorkbenchFacilityDefinitionRegistry(),
    );
    const listener = vi.fn();
    registry.subscribe(listener);
    const dispose = registry.registerSession(
      'session-1',
      htmlWorkbenchManifest,
      [sandboxBinding()],
    );
    const [active] = registry.listByTransport(
      CORE_SANDBOX_FRAME_TRANSPORT_FACILITY_ID,
      CORE_FACILITY_VERSION,
    );

    expect(active?.sessionId).toBe('session-1');
    expect(active && registry.isActive(active)).toBe(true);

    dispose();
    dispose();

    expect(active && registry.isActive(active)).toBe(false);
    expect(listener).toHaveBeenNthCalledWith(1, {
      type: 'registered',
      sessionId: 'session-1',
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      type: 'disposed',
      sessionId: 'session-1',
    });
  });

  it('rejects undeclared facilities, duplicate sessions and reused roots', () => {
    const registry = new WorkbenchTransportBindingRegistry(
      createCoreWorkbenchFacilityDefinitionRegistry(),
    );
    const binding = sandboxBinding();

    registry.registerSession(
      'session-1',
      htmlWorkbenchManifest,
      [binding],
    );

    expect(() =>
      registry.registerSession(
        'session-1',
        htmlWorkbenchManifest,
        [sandboxBinding('learning-content://resource/other')],
      ),
    ).toThrow('REGISTRATION_CONFLICT');
    expect(() =>
      registry.registerSession(
        'session-2',
        htmlWorkbenchManifest,
        [binding],
      ),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
    expect(() =>
      registry.registerSession(
        'session-3',
        htmlWorkbenchManifest,
        [
          {
            ...sandboxBinding(
              'learning-content://resource/third',
            ),
            facilities: [
              {
                id: 'test.input.undeclared',
                version: 1,
              },
            ],
          },
        ],
      ),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
  });

  it('does not create lifecycle state for providers without bindings', () => {
    const registry = new WorkbenchTransportBindingRegistry(
      createCoreWorkbenchFacilityDefinitionRegistry(),
    );
    const dispose = registry.registerSession(
      'session-1',
      htmlWorkbenchManifest,
      [],
    );

    expect(() =>
      registry.registerSession(
        'session-1',
        htmlWorkbenchManifest,
        [],
      ),
    ).not.toThrow();
    dispose();
  });
});
