import { describe, expect, it } from 'vitest';

import {
  ExternalLibraryRegistry,
} from './external-library-registry';

function createDefinition() {
  return {
    id: 'libreoffice',
    displayName: 'LibreOffice',
    description: 'Office preview',
    category: 'document' as const,
    version: '25.2.5.2',
    installationFormatVersion: 1,
    sourceUrl: 'https://www.libreoffice.org/',
    licenseName: 'MPL-2.0',
    licenseUrl: 'https://www.libreoffice.org/about-us/licenses',
    packages: [
      {
        platform: 'darwin' as const,
        architecture: 'arm64' as const,
        packageType: 'dmg' as const,
        downloadUrl: 'https://download.example/libreoffice.dmg',
        sha256: 'a'.repeat(64),
        expectedSize: 300_000_000,
        executableRelativePath:
          'LibreOffice.app/Contents/MacOS/soffice',
        payloadRelativePath: 'LibreOffice.app',
        verifyCodeSignature: true,
      },
      {
        platform: 'win32' as const,
        architecture: 'x64' as const,
        packageType: 'msi' as const,
        downloadUrl: 'https://download.example/libreoffice.msi',
        sha256: 'b'.repeat(64),
        expectedSize: 300_000_000,
        executableRelativePath: 'program/soffice.exe',
      },
    ],
  };
}

describe('ExternalLibraryRegistry', () => {
  it('registers immutable Definitions and selects platform packages', () => {
    const registry = new ExternalLibraryRegistry();
    const input = createDefinition();
    registry.register(input);

    const definition = registry.require('libreoffice');
    const packageDefinition = registry.selectPackage(
      'libreoffice',
      'darwin',
      'arm64',
    );

    expect(definition).toEqual(input);
    expect(definition).not.toBe(input);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.packages)).toBe(true);
    expect(packageDefinition.packageType).toBe('dmg');
    expect(
      registry.findPackage('libreoffice', 'win32', 'arm64'),
    ).toBeUndefined();
  });

  it('rejects duplicate, insecure and ambiguous Definitions', () => {
    const registry = new ExternalLibraryRegistry();
    const valid = createDefinition();
    registry.register(valid);

    expect(() => registry.register(valid)).toThrow(
      'REGISTRATION_CONFLICT',
    );
    expect(() =>
      new ExternalLibraryRegistry().register({
        ...valid,
        packages: [
          ...valid.packages,
          { ...valid.packages[0]! },
        ],
      }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
    expect(() =>
      new ExternalLibraryRegistry().register({
        ...valid,
        packages: [
          {
            ...valid.packages[0]!,
            downloadUrl: 'http://download.example/unsafe.dmg',
          },
        ],
      }),
    ).toThrow('INVALID_EXTENSION_DEFINITION');
  });

  it('reports unsupported platform packages explicitly', () => {
    const registry = new ExternalLibraryRegistry();
    registry.register(createDefinition());

    expect(() =>
      registry.selectPackage('libreoffice', 'win32', 'arm64'),
    ).toThrow('FEATURE_NOT_SUPPORTED');
    expect(() => registry.require('missing')).toThrow(
      'INVALID_EXTENSION_DEFINITION',
    );
  });

  it('selects a default or explicit package variant', () => {
    const registry = new ExternalLibraryRegistry();
    const base = createDefinition();
    const windowsPackage = base.packages[1]!;
    registry.register({
      ...base,
      id: 'media-subtitles',
      variants: [
        { id: 'cpu', displayName: 'CPU' },
        { id: 'nvidia', displayName: 'NVIDIA' },
      ],
      defaultVariantId: 'cpu',
      packages: [
        { ...windowsPackage, variantId: 'cpu' },
        {
          ...windowsPackage,
          variantId: 'nvidia',
          sha256: 'c'.repeat(64),
        },
      ],
    });

    expect(
      registry.selectPackage('media-subtitles', 'win32', 'x64')
        .variantId,
    ).toBe('cpu');
    expect(
      registry.selectPackage(
        'media-subtitles',
        'win32',
        'x64',
        'nvidia',
      ).variantId,
    ).toBe('nvidia');
    expect(
      registry.findPackages('media-subtitles', 'win32', 'x64'),
    ).toHaveLength(2);
  });
});
