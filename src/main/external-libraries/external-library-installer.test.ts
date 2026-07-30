import { describe, expect, it, vi } from 'vitest';

import {
  ExternalLibraryInstallerRegistry,
} from './external-library-installer';

describe('ExternalLibraryInstallerRegistry', () => {
  it('registers one Installer for each package type', () => {
    const registry = new ExternalLibraryInstallerRegistry();
    const dmg = {
      packageType: 'dmg' as const,
      install: vi.fn(),
    };
    const msi = {
      packageType: 'msi' as const,
      install: vi.fn(),
    };

    registry.register(dmg);
    registry.register(msi);

    expect(registry.require('dmg')).toBe(dmg);
    expect(registry.require('msi')).toBe(msi);
  });

  it('rejects duplicates and missing Installers', () => {
    const registry = new ExternalLibraryInstallerRegistry();
    const dmg = {
      packageType: 'dmg' as const,
      install: vi.fn(),
    };
    registry.register(dmg);

    expect(() => registry.register(dmg)).toThrow(
      'REGISTRATION_CONFLICT',
    );
    expect(() => registry.require('msi')).toThrow(
      'FEATURE_NOT_SUPPORTED',
    );
  });
});
