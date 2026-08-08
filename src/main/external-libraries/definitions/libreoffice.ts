import type {
  ExternalLibraryDefinition,
} from '../external-library-definition';

export const LIBREOFFICE_LIBRARY_ID = 'libreoffice';
export const LIBREOFFICE_VERSION = '26.2.5';

export const libreOfficeDefinition: ExternalLibraryDefinition =
  Object.freeze({
    id: LIBREOFFICE_LIBRARY_ID,
    displayName: 'LibreOffice',
    version: LIBREOFFICE_VERSION,
    installationFormatVersion: 1,
    sourceUrl: 'https://www.libreoffice.org/',
    licenseName: 'MPL-2.0',
    licenseUrl: 'https://www.libreoffice.org/about-us/licenses/',
    packages: Object.freeze([
      Object.freeze({
        platform: 'darwin',
        architecture: 'arm64',
        packageType: 'dmg',
        downloadUrl:
          'https://download.documentfoundation.org/libreoffice/stable/26.2.5/mac/aarch64/LibreOffice_26.2.5_MacOS_aarch64.dmg',
        sha256:
          'c99fb4fe574437fc4cb820a4ca15271bca325920861f7139858b36d7f9df78ad',
        expectedSize: 297_407_265,
        executableRelativePath:
          'LibreOffice.app/Contents/MacOS/soffice',
        payloadRelativePath: 'LibreOffice.app',
        verifyCodeSignature: true,
      }),
      Object.freeze({
        platform: 'darwin',
        architecture: 'x64',
        packageType: 'dmg',
        downloadUrl:
          'https://download.documentfoundation.org/libreoffice/stable/26.2.5/mac/x86_64/LibreOffice_26.2.5_MacOS_x86-64.dmg',
        sha256:
          'e26180298685274b54aa7fe6e1101c65465a372f457a6748ebd642720811db36',
        expectedSize: 307_933_587,
        executableRelativePath:
          'LibreOffice.app/Contents/MacOS/soffice',
        payloadRelativePath: 'LibreOffice.app',
        verifyCodeSignature: true,
      }),
      Object.freeze({
        platform: 'win32',
        architecture: 'x64',
        packageType: 'msi',
        downloadUrl:
          'https://download.documentfoundation.org/libreoffice/stable/26.2.5/win/x86_64/LibreOffice_26.2.5_Win_x86-64.msi',
        sha256:
          'f15ba07bfcb0186986cf3171063506f5d207c11f8cc051ba0d135209e9e915f9',
        expectedSize: 372_948_992,
        // soffice.exe is a GUI launcher and may return before a headless
        // conversion finishes. The console entry point waits for the worker
        // process and exposes its conversion diagnostics.
        executableRelativePath: 'program/soffice.com',
      }),
    ]),
  });
