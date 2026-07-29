import { describe, expect, it } from 'vitest';

import {
  isWorkbenchFacilityDeclaration,
  isWorkbenchFacilityId,
  workbenchFacilityKey,
} from './facility-declaration';

describe('WorkbenchFacilityDeclaration', () => {
  it('accepts namespaced versioned declarations', () => {
    expect(isWorkbenchFacilityId('core.input.text-selection')).toBe(
      true,
    );
    expect(
      isWorkbenchFacilityDeclaration({
        id: 'core.input.text-selection',
        version: 1,
        options: {
          capture: 'core.transport.renderer',
          publish: 'settled',
        },
      }),
    ).toBe(true);
    expect(
      workbenchFacilityKey('core.input.text-selection', 1),
    ).toBe('core.input.text-selection@1');
  });

  it('rejects unnamespaced, invalid-version, or non-json declarations', () => {
    expect(isWorkbenchFacilityId('selection')).toBe(false);
    expect(
      isWorkbenchFacilityDeclaration({
        id: 'core.input.text-selection',
        version: 0,
      }),
    ).toBe(false);
    expect(
      isWorkbenchFacilityDeclaration({
        id: 'core.input.text-selection',
        version: 1,
        options: { invalid: Number.NaN },
      }),
    ).toBe(false);
  });
});
