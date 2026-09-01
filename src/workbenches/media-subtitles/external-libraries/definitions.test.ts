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
  it('bumps the restored Windows CPU/NVIDIA package identity', () => {
    expect(mediaSubtitleSuiteDefinition).toMatchObject({
      id: MEDIA_SUBTITLE_SUITE_LIBRARY_ID,
      version: '2026.08.28',
      installationFormatVersion: 4,
      defaultVariantId: MEDIA_SUBTITLE_CPU_VARIANT_ID,
      variants: [
        { id: MEDIA_SUBTITLE_CPU_VARIANT_ID },
        { id: MEDIA_SUBTITLE_NVIDIA_VARIANT_ID },
      ],
    });
    expect(isExternalLibraryDefinition(mediaSubtitleSuiteDefinition)).toBe(
      true,
    );
    expect(
      createMediaSubtitleSuiteDefinition(MEDIA_SUBTITLE_NVIDIA_VARIANT_ID)
        .defaultVariantId,
    ).toBe(MEDIA_SUBTITLE_NVIDIA_VARIANT_ID);
  });

  it.each([
    [MEDIA_SUBTITLE_CPU_VARIANT_ID, 'sensevoice-runtime', 418_232_889],
    [MEDIA_SUBTITLE_NVIDIA_VARIANT_ID, 'whisper-runtime', 1_402_924_525],
  ] as const)(
    'installs one ASR engine plus the shared speaker runtime for %s',
    (variantId, transcriptionResource, expectedSize) => {
      const packageDefinition = mediaSubtitleSuiteDefinition.packages.find(
        (candidate) => candidate.variantId === variantId,
      )!;
      expect(packageDefinition.packageType).toBe('bundle');
      if (packageDefinition.packageType !== 'bundle') return;
      const ids = packageDefinition.resources.map(({ id }) => id);
      expect(ids).toContain('ffmpeg-runtime');
      expect(ids).toContain(transcriptionResource);
      expect(ids).toContain('speaker-runtime');
      expect(ids).toContain('speaker-segmentation-model');
      expect(ids).toContain('speaker-embedding-model');
      expect(ids.some((id) => id.includes('moss'))).toBe(false);
      expect(externalLibraryPackageExpectedSize(packageDefinition)).toBe(
        expectedSize,
      );
      expect(packageDefinition.recommendedFreeSpace).toBeGreaterThan(
        packageDefinition.estimatedInstalledSize!,
      );
    },
  );

  it('pins every download to HTTPS, size and SHA-256', () => {
    for (const packageDefinition of mediaSubtitleSuiteDefinition.packages) {
      if (packageDefinition.packageType !== 'bundle') continue;
      for (const resource of packageDefinition.resources) {
        expect(resource.downloadUrl).toMatch(/^https:\/\//u);
        expect(resource.expectedSize).toBeGreaterThan(0);
        expect(resource.sha256).toMatch(/^[a-f0-9]{64}$/u);
      }
    }
  });
});
