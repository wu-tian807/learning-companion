import { describe, expect, it } from 'vitest';

import {
  externalLibraryPackageExpectedSize,
  externalLibraryPackageFingerprint,
  isExternalLibraryDefinition,
  type ExternalLibraryDefinition,
} from './external-library-definition';

function createBundleDefinition(): ExternalLibraryDefinition {
  return {
    id: 'subtitle-runtime',
    displayName: 'Subtitle runtime',
    description: 'Local subtitle processing',
    category: 'media',
    version: '1.0.0',
    installationFormatVersion: 1,
    sourceUrl: 'https://example.com/source',
    licenseName: 'MIT',
    licenseUrl: 'https://example.com/license',
    packages: [
      {
        platform: 'win32',
        architecture: 'x64',
        packageType: 'bundle',
        resources: [
          {
            id: 'runtime',
            downloadUrl: 'https://example.com/runtime.zip',
            sha256: 'a'.repeat(64),
            expectedSize: 10,
            installation: {
              type: 'zip',
              destinationRelativePath: 'engine',
            },
          },
          {
            id: 'model',
            downloadUrl: 'https://example.com/model.bin',
            sha256: 'b'.repeat(64),
            expectedSize: 20,
            installation: {
              type: 'file',
              destinationRelativePath: 'models/model.bin',
            },
          },
        ],
        requiredRelativePaths: [
          'engine/cli.exe',
          'models/model.bin',
        ],
        executableRelativePath: 'engine/cli.exe',
      },
    ],
  };
}

describe('ExternalLibraryDefinition bundles', () => {
  it('validates a multi-resource package and aggregates download size', () => {
    const definition = createBundleDefinition();
    const packageDefinition = definition.packages[0]!;

    expect(isExternalLibraryDefinition(definition)).toBe(true);
    expect(externalLibraryPackageExpectedSize(packageDefinition)).toBe(30);
    expect(externalLibraryPackageFingerprint(packageDefinition)).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });

  it('requires installed-size and free-space estimates as a valid pair', () => {
    const definition = createBundleDefinition();
    const packageDefinition = definition.packages[0]!;
    const withEstimates = {
      ...definition,
      packages: [
        {
          ...packageDefinition,
          estimatedInstalledSize: 40,
          recommendedFreeSpace: 60,
        },
      ],
    };

    expect(isExternalLibraryDefinition(withEstimates)).toBe(true);
    expect(
      isExternalLibraryDefinition({
        ...withEstimates,
        packages: [
          {
            ...withEstimates.packages[0],
            recommendedFreeSpace: 30,
          },
        ],
      }),
    ).toBe(false);
    expect(
      isExternalLibraryDefinition({
        ...definition,
        packages: [
          {
            ...packageDefinition,
            estimatedInstalledSize: 40,
          },
        ],
      }),
    ).toBe(false);
  });

  it('keeps the existing single-package marker fingerprint stable', () => {
    const sha256 = 'c'.repeat(64);
    expect(
      externalLibraryPackageFingerprint({
        platform: 'win32',
        architecture: 'x64',
        packageType: 'msi',
        downloadUrl: 'https://example.com/runtime.msi',
        sha256,
        expectedSize: 10,
        executableRelativePath: 'program/runtime.exe',
      }),
    ).toBe(sha256);
  });

  it('rejects duplicate destinations and undeclared entry points', () => {
    const definition = createBundleDefinition();
    const packageDefinition = definition.packages[0]!;
    if (packageDefinition.packageType !== 'bundle') {
      throw new Error('expected bundle');
    }

    expect(
      isExternalLibraryDefinition({
        ...definition,
        packages: [
          {
            ...packageDefinition,
            resources: packageDefinition.resources.map((resource) => ({
              ...resource,
              installation: {
                ...resource.installation,
                destinationRelativePath: 'same/path.bin',
              },
            })),
          },
        ],
      }),
    ).toBe(false);
    expect(
      isExternalLibraryDefinition({
        ...definition,
        packages: [
          {
            ...packageDefinition,
            executableRelativePath: 'engine/other.exe',
          },
        ],
      }),
    ).toBe(false);
  });

  it('requires explicit, unique variants for same-platform packages', () => {
    const definition = createBundleDefinition();
    const packageDefinition = definition.packages[0]!;
    const variantDefinition = {
      ...definition,
      variants: [
        { id: 'cpu', displayName: 'CPU' },
        { id: 'nvidia', displayName: 'NVIDIA' },
      ],
      defaultVariantId: 'cpu',
      packages: [
        { ...packageDefinition, variantId: 'cpu' },
        { ...packageDefinition, variantId: 'nvidia' },
      ],
    };

    expect(isExternalLibraryDefinition(variantDefinition)).toBe(true);
    expect(
      externalLibraryPackageFingerprint(
        variantDefinition.packages[0]!,
      ),
    ).not.toBe(
      externalLibraryPackageFingerprint(
        variantDefinition.packages[1]!,
      ),
    );
    expect(
      isExternalLibraryDefinition({
        ...variantDefinition,
        defaultVariantId: 'missing',
      }),
    ).toBe(false);
    expect(
      isExternalLibraryDefinition({
        ...variantDefinition,
        packages: [
          variantDefinition.packages[0]!,
          { ...variantDefinition.packages[1]!, variantId: 'cpu' },
        ],
      }),
    ).toBe(false);
  });
});
