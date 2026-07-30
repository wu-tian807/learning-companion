import { describe, expect, it } from 'vitest';

import {
  ExternalLibraryRegistry,
} from './external-library-registry';

function createDefinition() {
  return {
    id: 'libreoffice',
    displayName: 'LibreOffice',
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
      },
      {
        platform: 'win32' as const,
        architecture: 'x64' as const,
        packageType: 'msi' as const,
        downloadUrl: 'https://download.example/libreoffice.msi',
        sha256: 'b'.repeat(64),
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
});
