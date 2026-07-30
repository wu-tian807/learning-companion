import { describe, expect, it } from 'vitest';

import {
  isExternalLibraryDefinition,
} from '../external-library-definition';
import {
  LIBREOFFICE_LIBRARY_ID,
  LIBREOFFICE_VERSION,
  libreOfficeDefinition,
} from './libreoffice';

describe('LibreOffice ExternalLibraryDefinition', () => {
  it('pins official packages for every supported release target', () => {
    expect(isExternalLibraryDefinition(libreOfficeDefinition)).toBe(true);
    expect(libreOfficeDefinition.id).toBe(LIBREOFFICE_LIBRARY_ID);
    expect(libreOfficeDefinition.version).toBe(LIBREOFFICE_VERSION);
    expect(
      libreOfficeDefinition.packages.map(
        ({ platform, architecture }) =>
          `${platform}-${architecture}`,
      ),
    ).toEqual(['darwin-arm64', 'darwin-x64', 'win32-x64']);
  });

  it('uses official HTTPS downloads with fixed size and SHA-256', () => {
    for (const packageDefinition of libreOfficeDefinition.packages) {
      expect(packageDefinition.downloadUrl).toMatch(
        /^https:\/\/download\.documentfoundation\.org\/libreoffice\/stable\/26\.2\.5\//u,
      );
      expect(packageDefinition.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(packageDefinition.expectedSize).toBeGreaterThan(
        250_000_000,
      );
    }
  });
});
