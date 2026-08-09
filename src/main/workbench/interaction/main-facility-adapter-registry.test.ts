import { describe, expect, it } from 'vitest';

import {
  CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
  createCoreWorkbenchFacilityDefinitionRegistry,
} from '../../../shared/workbench/facilities/core-facilities';
import { MainFacilityAdapterRegistry } from './main-facility-adapter-registry';
import {
  SANDBOX_SELECTION_SETTLED_TRIGGER,
} from './sandbox-frame-interaction-triggers';
import {
  HtmlTextSelectionFacilityAdapter,
} from '../../../workbenches/html/main-facility-adapters';
import { HTML_WORKBENCH_ID } from '../../../workbenches/html/shared';

describe('MainFacilityAdapterRegistry', () => {
  it('resolves an adapter only for one of its declared triggers', () => {
    const registry = new MainFacilityAdapterRegistry(
      createCoreWorkbenchFacilityDefinitionRegistry(),
    );
    const adapter = new HtmlTextSelectionFacilityAdapter();
    const dispose = registry.register(adapter);

    expect(
      registry.get(
        HTML_WORKBENCH_ID,
        CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        1,
        SANDBOX_SELECTION_SETTLED_TRIGGER,
      ),
    ).toBe(adapter);
    expect(
      registry.get(
        HTML_WORKBENCH_ID,
        CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        1,
        'sandbox.unknown',
      ),
    ).toBeUndefined();

    dispose();
    expect(
      registry.get(
        HTML_WORKBENCH_ID,
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
    const adapter = new HtmlTextSelectionFacilityAdapter();

    registry.register(adapter);

    expect(() => registry.register(adapter)).toThrow(
      'REGISTRATION_CONFLICT',
    );

    const otherWorkbenchAdapter = {
      workbenchId: 'test.other-workbench',
      facilityId: adapter.facilityId,
      facilityVersion: adapter.facilityVersion,
      triggers: adapter.triggers,
      dedupe: adapter.dedupe,
      capture: adapter.capture.bind(adapter),
    };
    registry.register(otherWorkbenchAdapter);
    expect(
      registry.get(
        otherWorkbenchAdapter.workbenchId,
        CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        1,
        SANDBOX_SELECTION_SETTLED_TRIGGER,
      ),
    ).toBe(otherWorkbenchAdapter);
    expect(
      registry.get(
        'test.unregistered-workbench',
        CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        1,
        SANDBOX_SELECTION_SETTLED_TRIGGER,
      ),
    ).toBeUndefined();

    expect(() =>
      registry.register({
        workbenchId: HTML_WORKBENCH_ID,
        facilityId: 'test.input.unknown',
        facilityVersion: 1,
        triggers: ['sandbox.test'],
        capture: () => null,
      }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
    expect(() =>
      registry.register({
        workbenchId: ` ${HTML_WORKBENCH_ID}`,
        facilityId: CORE_TEXT_SELECTION_INPUT_FACILITY_ID,
        facilityVersion: 1,
        triggers: ['sandbox.test'],
        capture: () => null,
      }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
  });
});
