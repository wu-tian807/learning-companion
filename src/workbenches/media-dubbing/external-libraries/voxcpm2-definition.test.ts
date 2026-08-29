import { describe, expect, it } from 'vitest';

import {
  externalLibraryPackageExpectedSize,
  isExternalLibraryDefinition,
} from '../../../main/external-libraries/external-library-definition';
import {
  MEDIA_DUBBING_VOXCPM2_LIBRARY_ID,
  mediaDubbingVoxCpm2Definition,
} from './voxcpm2-definition';

describe('VoxCPM2 dubbing external library', () => {
  it('defines one pinned Windows GPU bundle', () => {
    expect(isExternalLibraryDefinition(mediaDubbingVoxCpm2Definition)).toBe(
      true,
    );
    expect(mediaDubbingVoxCpm2Definition.id).toBe(
      MEDIA_DUBBING_VOXCPM2_LIBRARY_ID,
    );
    expect(mediaDubbingVoxCpm2Definition.packages).toHaveLength(1);
    expect(mediaDubbingVoxCpm2Definition.packages[0]).toMatchObject({
      platform: 'win32',
      architecture: 'x64',
      packageType: 'bundle',
    });
  });

  it('installs only the selected VoxCPM2, UVR and bootstrap resources', () => {
    const packageDefinition = mediaDubbingVoxCpm2Definition.packages[0]!;
    expect(packageDefinition.packageType).toBe('bundle');
    if (packageDefinition.packageType !== 'bundle') return;

    const resourceIds = packageDefinition.resources.map(({ id }) => id);
    expect(resourceIds).toContain('voxcpm2-weights');
    expect(resourceIds).toContain('uvr-source-separation-model');
    expect(resourceIds).toContain('uv-runtime');
    expect(resourceIds.some((id) => /f5|voxcpm1[.-]?5/iu.test(id))).toBe(false);
    expect(externalLibraryPackageExpectedSize(packageDefinition)).toBe(
      5_036_776_566,
    );
  });

  it('pins every download to HTTPS, size and SHA-256', () => {
    const packageDefinition = mediaDubbingVoxCpm2Definition.packages[0]!;
    expect(packageDefinition.packageType).toBe('bundle');
    if (packageDefinition.packageType !== 'bundle') return;

    for (const resource of packageDefinition.resources) {
      expect(resource.downloadUrl).toMatch(/^https:\/\//u);
      expect(resource.expectedSize).toBeGreaterThan(0);
      expect(resource.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }
  });
});
