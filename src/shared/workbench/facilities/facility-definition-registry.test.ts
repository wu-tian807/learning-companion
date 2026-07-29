import { describe, expect, it } from 'vitest';

import {
  CORE_RENDERER_TRANSPORT_FACILITY_ID,
  createContextMenuSurfaceFacilityDeclaration,
  createCoreWorkbenchFacilityDefinitionRegistry,
  createTextSelectionInputFacilityDeclaration,
  rendererTransportFacilityDeclaration,
} from './core-facilities';
import { defineWorkbenchFacility } from './facility-definition';
import { WorkbenchFacilityDefinitionRegistry } from './facility-definition-registry';

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('WorkbenchFacilityDefinitionRegistry', () => {
  it('validates core declarations and their transport dependencies', () => {
    const registry =
      createCoreWorkbenchFacilityDefinitionRegistry();
    const contextMenu = createContextMenuSurfaceFacilityDeclaration(
      CORE_RENDERER_TRANSPORT_FACILITY_ID,
    );
    const textSelection =
      createTextSelectionInputFacilityDeclaration(
        CORE_RENDERER_TRANSPORT_FACILITY_ID,
      );

    expect(
      registry.validateDeclarations([
        rendererTransportFacilityDeclaration,
        contextMenu,
        textSelection,
      ]),
    ).toBe(true);
    expect(
      registry.validateDeclarations([contextMenu, textSelection]),
    ).toBe(false);
  });

  it('rejects unknown, duplicate, and invalid-option declarations', () => {
    const registry =
      createCoreWorkbenchFacilityDefinitionRegistry();

    expect(
      registry.validateDeclarations([
        rendererTransportFacilityDeclaration,
        rendererTransportFacilityDeclaration,
      ]),
    ).toBe(false);
    expect(
      registry.validateDeclarations([
        { id: 'test.input.region-selection', version: 1 },
      ]),
    ).toBe(false);
    expect(
      registry.validateDeclarations([
        rendererTransportFacilityDeclaration,
        {
          id: 'core.surface.context-menu',
          version: 1,
          options: { capture: 'unknown.transport' },
        },
      ]),
    ).toBe(false);
  });

  it('supports extension definitions without changing the registry', () => {
    const registry = new WorkbenchFacilityDefinitionRegistry();
    const definition = defineWorkbenchFacility({
      id: 'test.input.region-selection',
      version: 1,
      role: 'input',
      inputCardinality: 'many',
      validateOptions: (
        value,
      ): value is undefined => value === undefined,
      validateEvent: (
        value,
      ): value is typeof value & { readonly x: number } =>
        isRecord(value) && typeof value.x === 'number',
      validateInput: (value) =>
        isRecord(value) && typeof value.x === 'number',
    });
    const dispose = registry.register(definition);

    expect(
      registry.validateDeclarations([
        { id: definition.id, version: definition.version },
      ]),
    ).toBe(true);
    expect(
      registry.validateEvent(definition.id, definition.version, {
        x: 0.25,
      }),
    ).toBe(true);

    dispose();
    expect(
      registry.validateDeclarations([
        { id: definition.id, version: definition.version },
      ]),
    ).toBe(false);
  });

  it('rejects duplicate definitions', () => {
    const registry = new WorkbenchFacilityDefinitionRegistry();
    const definition = defineWorkbenchFacility({
      id: 'test.surface.menu',
      version: 1,
      role: 'surface',
      validateOptions: (
        value,
      ): value is undefined => value === undefined,
    });

    registry.register(definition);

    expect(() => registry.register(definition)).toThrow(
      'Workbench Facility 重复注册',
    );
  });
});
