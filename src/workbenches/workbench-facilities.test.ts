import { describe, expect, it } from 'vitest';

import { createCoreWorkbenchFacilityDefinitionRegistry } from '../shared/workbench/facilities/core-facilities';
import type { AssetWorkbenchManifest } from '../shared/workbench/manifest';
import { mainWorkbenchContributions } from './catalog/register-main-workbenches';
import { unsupportedWorkbenchManifest } from './unsupported/shared';

function facilityIds(manifest: AssetWorkbenchManifest): string[] {
  return manifest.facilities.map((facility) => facility.id).sort();
}

describe('built-in Workbench Facility matrix', () => {
  const manifests = [
    unsupportedWorkbenchManifest,
    ...mainWorkbenchContributions.flatMap(({ manifest }) =>
      manifest ? [manifest] : []),
  ];

  it('keeps every built-in manifest valid against the core registry', () => {
    const registry =
      createCoreWorkbenchFacilityDefinitionRegistry();

    for (const manifest of manifests) {
      expect(
        registry.validateDeclarations(manifest.facilities),
        manifest.id,
      ).toBe(true);
    }
  });

  it('declares the expected optional facilities per workbench', () => {
    expect(
      Object.fromEntries(
        manifests.map((manifest) => [
          manifest.id,
          facilityIds(manifest),
        ]),
      ),
    ).toEqual({
      'builtin.unsupported': [],
      'builtin.plain-text': [
        'core.export.location-reference',
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.markdown': [
        'core.export.location-reference',
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.mindmap': [
        'core.export.location-reference',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.learning-outline': [],
      'builtin.pdf': [
        'core.export.location-reference',
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.office': [
        'core.export.location-reference',
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.image': [
        'core.export.location-reference',
        'core.surface.context-menu',
        'core.surface.header',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.audio': [
        'core.export.location-reference',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.video': [
        'core.export.location-reference',
        'core.surface.context-menu',
        'core.surface.header',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.html': [
        'core.export.location-reference',
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.sandbox-frame',
      ],
      'builtin.epub': [
        'core.export.location-reference',
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.transport.renderer',
      ],
    });
  });
});
