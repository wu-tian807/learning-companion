import { describe, expect, it } from 'vitest';

import {
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
  createCoreWorkbenchFacilityDefinitionRegistry,
} from '../../../shared/workbench/facilities/core-facilities';
import { MainFacilityAdapterRegistry } from './main-facility-adapter-registry';
import {
  SANDBOX_SELECTION_SETTLED_TRIGGER,
  SandboxTextSelectionFacilityAdapter,
} from './adapters/sandbox-text-selection-facility-adapter';

describe('MainFacilityAdapterRegistry', () => {
  it('resolves an adapter only for one of its declared triggers', () => {
    const registry = new MainFacilityAdapterRegistry(
      createCoreWorkbenchFacilityDefinitionRegistry(),
    );
    const adapter = new SandboxTextSelectionFacilityAdapter();
    const dispose = registry.register(adapter);

    expect(
      registry.get(
        CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        1,
        SANDBOX_SELECTION_SETTLED_TRIGGER,
      ),
    ).toBe(adapter);
    expect(
      registry.get(
        CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        1,
        'sandbox.unknown',
      ),
    ).toBeUndefined();

    dispose();
    expect(
      registry.get(
        CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        1,
        SANDBOX_SELECTION_SETTLED_TRIGGER,
      ),
    ).toBeUndefined();
  });

  it('rejects duplicate and unknown facility adapters', () => {
    const registry = new MainFacilityAdapterRegistry(
      createCoreWorkbenchFacilityDefinitionRegistry(),
    );
    const adapter = new SandboxTextSelectionFacilityAdapter();

    registry.register(adapter);

    expect(() => registry.register(adapter)).toThrow(
      'REGISTRATION_CONFLICT',
    );
    expect(() =>
      registry.register({
        facilityId: 'test.input.unknown',
        facilityVersion: 1,
        triggers: ['sandbox.test'],
        capture: () => null,
      }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
  });
});
