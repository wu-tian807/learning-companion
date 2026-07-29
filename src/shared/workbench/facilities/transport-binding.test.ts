import { describe, expect, it } from 'vitest';

import { isWorkbenchTransportBinding } from './transport-binding';

describe('Workbench Transport Binding', () => {
  it('accepts an open, versioned transport binding', () => {
    expect(
      isWorkbenchTransportBinding({
        transportId: 'core.transport.sandbox-frame',
        transportVersion: 1,
        facilities: [
          { id: 'core.input.text-selection', version: 1 },
          { id: 'core.surface.context-menu', version: 1 },
        ],
        payload: {
          rootUrl: 'learning-content://resource/token',
        },
      }),
    ).toBe(true);
  });

  it('rejects duplicate facilities and non-JSON payloads', () => {
    expect(
      isWorkbenchTransportBinding({
        transportId: 'core.transport.sandbox-frame',
        transportVersion: 1,
        facilities: [
          { id: 'core.input.text-selection', version: 1 },
          { id: 'core.input.text-selection', version: 1 },
        ],
        payload: {},
      }),
    ).toBe(false);
    expect(
      isWorkbenchTransportBinding({
        transportId: 'core.transport.sandbox-frame',
        transportVersion: 1,
        facilities: [
          { id: 'core.input.text-selection', version: 1 },
        ],
        payload: { callback: () => undefined },
      }),
    ).toBe(false);
  });
});
