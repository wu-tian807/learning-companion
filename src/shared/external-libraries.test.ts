import { describe, expect, it } from 'vitest';

import {
  cloneExternalLibrarySnapshot,
  isExternalLibrarySnapshot,
} from './external-libraries';

describe('ExternalLibrarySnapshot', () => {
  it('validates and clones Renderer-safe runtime state', () => {
    const snapshot = cloneExternalLibrarySnapshot({
      id: 'libreoffice',
      displayName: 'LibreOffice',
      version: '25.2.5.2',
      expectedSize: 300_000_000,
      rootPath: '/Users/student/Documents/Learning Companion/externalLib',
      status: 'downloading',
      progress: {
        completedBytes: 100,
        totalBytes: 300_000_000,
      },
    });

    expect(isExternalLibrarySnapshot(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.progress)).toBe(true);
  });

  it('rejects malformed progress and relative paths', () => {
    expect(
      isExternalLibrarySnapshot({
        id: 'libreoffice',
        displayName: 'LibreOffice',
        version: '1',
        expectedSize: 10,
        rootPath: 'externalLib',
        status: 'available',
      }),
    ).toBe(false);
    expect(
      isExternalLibrarySnapshot({
        id: 'libreoffice',
        displayName: 'LibreOffice',
        version: '1',
        expectedSize: 10,
        rootPath: '/externalLib',
        status: 'downloading',
        progress: { completedBytes: 11, totalBytes: 10 },
      }),
    ).toBe(false);
  });
});
