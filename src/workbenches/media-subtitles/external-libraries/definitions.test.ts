import { describe, expect, it } from 'vitest';

import {
  externalLibraryPackageExpectedSize,
  isExternalLibraryDefinition,
} from '../../../main/external-libraries/external-library-definition';
import {
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
  MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
  MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
  createMediaSubtitleSuiteDefinition,
  mediaSubtitleSuiteDefinition,
} from './definitions';

describe('media subtitle external library', () => {
  it('defines one suite with two internal hardware profiles', () => {
    expect(mediaSubtitleSuiteDefinition.id).toBe(
      MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
    );
    expect(mediaSubtitleSuiteDefinition.variants).toEqual([
      { id: MEDIA_SUBTITLE_CPU_VARIANT_ID, displayName: 'CPU 兼容版' },
      {
        id: MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
        displayName: 'NVIDIA GPU 加速版',
      },
    ]);
    expect(mediaSubtitleSuiteDefinition.defaultVariantId).toBe(
      MEDIA_SUBTITLE_CPU_VARIANT_ID,
    );
    expect(isExternalLibraryDefinition(mediaSubtitleSuiteDefinition)).toBe(
      true,
    );
    expect(
      createMediaSubtitleSuiteDefinition(MEDIA_SUBTITLE_NVIDIA_VARIANT_ID)
        .defaultVariantId,
    ).toBe(MEDIA_SUBTITLE_NVIDIA_VARIANT_ID);
  });

  it('gives each profile exactly one local recognition engine', () => {
    for (const packageDefinition of mediaSubtitleSuiteDefinition.packages) {
      expect(packageDefinition.packageType).toBe('bundle');
      if (packageDefinition.packageType !== 'bundle') continue;

      const resourceIds = packageDefinition.resources.map(({ id }) => id);
      expect(resourceIds).toContain('ffmpeg-runtime');
      expect(resourceIds.some((id) => id.includes('translation'))).toBe(false);
      expect(resourceIds.some((id) => id.includes('hymt'))).toBe(false);

      if (packageDefinition.variantId === MEDIA_SUBTITLE_CPU_VARIANT_ID) {
        expect(resourceIds).toContain('sensevoice-runtime');
        expect(resourceIds).toContain('sensevoice-model');
        expect(resourceIds).not.toContain('whisper-runtime');
        expect(resourceIds).not.toContain('whisper-model');
      } else {
        expect(resourceIds).toContain('whisper-runtime');
        expect(resourceIds).toContain('whisper-model');
        expect(resourceIds).not.toContain('sensevoice-runtime');
        expect(resourceIds).not.toContain('sensevoice-model');
      }
    }
  });

  it('reports the complete download size for the selected variant', () => {
    const cpu = mediaSubtitleSuiteDefinition.packages.find(
      ({ variantId }) => variantId === MEDIA_SUBTITLE_CPU_VARIANT_ID,
    )!;
    const nvidia = mediaSubtitleSuiteDefinition.packages.find(
      ({ variantId }) => variantId === MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
    )!;

    expect(externalLibraryPackageExpectedSize(cpu)).toBe(370_574_146);
    expect(externalLibraryPackageExpectedSize(nvidia)).toBe(1_355_265_782);
  });

  it('pins every downloaded resource to HTTPS, size and SHA-256', () => {
    for (const packageDefinition of mediaSubtitleSuiteDefinition.packages) {
      expect(packageDefinition.packageType).toBe('bundle');
      if (packageDefinition.packageType !== 'bundle') continue;
      for (const resource of packageDefinition.resources) {
        expect(resource.downloadUrl).toMatch(/^https:\/\//u);
        expect(resource.expectedSize).toBeGreaterThan(0);
        expect(resource.sha256).toMatch(/^[a-f0-9]{64}$/u);
      }
    }
  });
});
