import { describe, expect, it } from 'vitest';

import {
  externalLibraryPackageExpectedSize,
  isExternalLibraryDefinition,
} from '../../../main/external-libraries/external-library-definition';
import {
  MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID,
  MEDIA_SUBTITLE_CPU_VARIANT_ID,
  MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
  MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
  createMediaSubtitleSuiteDefinition,
  mediaSubtitleSuiteDefinition,
} from './definitions';

describe('media subtitle external library', () => {
  it('defines one suite with exact CPU, NVIDIA and Apple-Silicon profiles', () => {
    expect(mediaSubtitleSuiteDefinition.id).toBe(
      MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
    );
    expect(mediaSubtitleSuiteDefinition.version).toBe('2026.08.28');
    expect(mediaSubtitleSuiteDefinition.installationFormatVersion).toBe(3);
    expect(mediaSubtitleSuiteDefinition.variants).toEqual([
      {
        id: MEDIA_SUBTITLE_CPU_VARIANT_ID,
        displayName: 'Windows CPU 兼容版',
      },
      {
        id: MEDIA_SUBTITLE_NVIDIA_VARIANT_ID,
        displayName: 'Windows NVIDIA 加速版',
      },
      {
        id: MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID,
        displayName: 'macOS Apple Silicon 版',
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

  it('downloads exactly one recognition and speaker strategy per profile', () => {
    for (const packageDefinition of mediaSubtitleSuiteDefinition.packages) {
      expect(packageDefinition.packageType).toBe('bundle');
      if (packageDefinition.packageType !== 'bundle') continue;

      const resourceIds = packageDefinition.resources.map(({ id }) => id);
      expect(resourceIds).toContain('ffmpeg-runtime');
      expect(resourceIds.some((id) => id.includes('translation'))).toBe(false);
      expect(resourceIds.some((id) => id.includes('hymt'))).toBe(false);

      if (packageDefinition.variantId === MEDIA_SUBTITLE_CPU_VARIANT_ID) {
        expect(resourceIds).toEqual([
          'ffmpeg-runtime',
          'sensevoice-runtime',
          'sensevoice-model',
          'sensevoice-fsmn-vad',
          'speaker-runtime',
          'speaker-segmentation-model',
          'speaker-embedding-model',
        ]);
        expect(resourceIds).toContain('sensevoice-runtime');
        expect(resourceIds).toContain('sensevoice-model');
        expect(resourceIds).toContain('speaker-runtime');
        expect(resourceIds).toContain('speaker-segmentation-model');
        expect(resourceIds).toContain('speaker-embedding-model');
        expect(resourceIds).not.toContain('moss-native-runtime');
        expect(resourceIds).not.toContain('moss-model-q5');
      } else {
        expect(resourceIds).toContain('moss-native-runtime');
        expect(resourceIds).toContain('moss-model-q5');
        expect(resourceIds).not.toContain('sensevoice-runtime');
        expect(resourceIds).not.toContain('sensevoice-model');
        expect(resourceIds).not.toContain('speaker-runtime');
        expect(resourceIds).not.toContain('speaker-segmentation-model');
        expect(resourceIds).not.toContain('speaker-embedding-model');
        if (
          packageDefinition.variantId ===
          MEDIA_SUBTITLE_NVIDIA_VARIANT_ID
        ) {
          expect(resourceIds).toEqual([
            'ffmpeg-runtime',
            'moss-python-runtime',
            'moss-native-runtime',
            'moss-cuda-cublas-runtime',
            'moss-cuda-core-runtime',
            'moss-python-binding',
            'moss-model-q5',
          ]);
          expect(resourceIds).toContain('moss-cuda-cublas-runtime');
          expect(resourceIds).toContain('moss-cuda-core-runtime');
        } else {
          expect(resourceIds).toEqual([
            'ffmpeg-runtime',
            'moss-python-runtime',
            'moss-native-runtime',
            'moss-python-binding',
            'moss-model-q5',
          ]);
          expect(resourceIds).not.toContain('moss-cuda-cublas-runtime');
          expect(resourceIds).not.toContain('moss-cuda-core-runtime');
        }
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
    const appleSilicon = mediaSubtitleSuiteDefinition.packages.find(
      ({ variantId }) =>
        variantId === MEDIA_SUBTITLE_APPLE_SILICON_VARIANT_ID,
    )!;

    expect(externalLibraryPackageExpectedSize(cpu)).toBe(418_232_889);
    expect(externalLibraryPackageExpectedSize(nvidia)).toBe(1_612_655_825);
    expect(externalLibraryPackageExpectedSize(appleSilicon)).toBe(747_794_395);
    expect(cpu.recommendedFreeSpace).toBeGreaterThan(
      cpu.estimatedInstalledSize!,
    );
    expect(nvidia.recommendedFreeSpace).toBeGreaterThan(
      nvidia.estimatedInstalledSize!,
    );
    expect(appleSilicon.recommendedFreeSpace).toBeGreaterThan(
      appleSilicon.estimatedInstalledSize!,
    );
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
