import { describe, expect, it } from 'vitest';

import { createCoreWorkbenchFacilityDefinitionRegistry } from '../shared/workbench/facilities/core-facilities';
import type { AssetWorkbenchManifest } from '../shared/workbench/manifest';
import { audioWorkbenchManifest } from './audio/shared';
import { epubWorkbenchManifest } from './epub/shared';
import { htmlWorkbenchManifest } from './html/shared';
import { imageWorkbenchManifest } from './image/shared';
import { markdownWorkbenchManifest } from './markdown/shared';
import { mindMapWorkbenchManifest } from './mindmap/shared';
import { pdfWorkbenchManifest } from './pdf/shared';
import { plainTextWorkbenchManifest } from './plain-text/shared';
import { unsupportedWorkbenchManifest } from './unsupported/shared';
import { videoWorkbenchManifest } from './video/shared';

function facilityIds(manifest: AssetWorkbenchManifest): string[] {
  return manifest.facilities.map((facility) => facility.id).sort();
}

describe('built-in Workbench Facility matrix', () => {
  const manifests = [
    unsupportedWorkbenchManifest,
    plainTextWorkbenchManifest,
    markdownWorkbenchManifest,
    mindMapWorkbenchManifest,
    pdfWorkbenchManifest,
    imageWorkbenchManifest,
    audioWorkbenchManifest,
    videoWorkbenchManifest,
    htmlWorkbenchManifest,
    epubWorkbenchManifest,
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
        'core.surface.generation-center',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.pdf': [
        'core.input.text-selection',
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.image': [
        'core.surface.context-menu',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.audio': [
        'core.surface.context-menu',
        'core.surface.generation-center',
        'core.surface.overflow',
        'core.transport.renderer',
      ],
      'builtin.video': [
        'core.surface.context-menu',
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
