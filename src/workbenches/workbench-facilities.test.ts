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
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.markdown': [
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.mindmap': [
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.pdf': [
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.office': [
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.image': [
        'core.surface.context-menu',
        'core.surface.header',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.audio': [
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.video': [
        'core.surface.context-menu',
        'core.surface.header',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.html': [
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.sandbox-frame',
      ],
      'builtin.epub': [
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.transport.renderer',
      ],
    });
  });
});
