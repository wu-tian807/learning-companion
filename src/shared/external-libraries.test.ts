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
      description: 'Office preview',
      category: 'document',
      version: '25.2.5.2',
      expectedSize: 300_000_000,
      estimatedInstalledSize: 900_000_000,
      recommendedFreeSpace: 1_200_000_000,
      rootPath: '/Users/student/Documents/Learning Companion/externalLib',
      status: 'downloading',
      statusDetail: '正在下载模型',
      progress: {
        completedBytes: 100,
        totalBytes: 300_000_000,
      },
    });

    expect(isExternalLibrarySnapshot(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.progress)).toBe(true);
    expect(snapshot.statusDetail).toBe('正在下载模型');
    expect(snapshot.estimatedInstalledSize).toBe(900_000_000);
  });

  it('rejects incomplete or inverted storage estimates', () => {
    const base = {
      id: 'media-subtitles',
      displayName: 'Media subtitles',
      description: 'Local subtitles',
      category: 'media',
      version: '1',
      expectedSize: 100,
      rootPath: '/externalLib',
      status: 'not-installed',
    } as const;

    expect(
      isExternalLibrarySnapshot({
        ...base,
        estimatedInstalledSize: 200,
      }),
    ).toBe(false);
    expect(
      isExternalLibrarySnapshot({
        ...base,
        estimatedInstalledSize: 200,
        recommendedFreeSpace: 199,
      }),
    ).toBe(false);
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
        description: 'Office preview',
        category: 'document',
        version: '1',
        expectedSize: 10,
        rootPath: '/externalLib',
        status: 'installing',
        statusDetail: '   ',
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

  it('allows a missing package size only for unsupported platforms', () => {
    const unsupported = cloneExternalLibrarySnapshot({
      id: 'libreoffice',
      displayName: 'LibreOffice',
      description: 'Office preview',
      category: 'document',
      version: '1',
      rootPath: '/externalLib',
      status: 'unsupported',
    });

    expect(unsupported).not.toHaveProperty('expectedSize');
    expect(
      isExternalLibrarySnapshot({
        ...unsupported,
        expectedSize: 10,
      }),
    ).toBe(false);
    expect(
      isExternalLibrarySnapshot({
        id: 'libreoffice',
        displayName: 'LibreOffice',
        version: '1',
        rootPath: '/externalLib',
        status: 'not-installed',
      }),
    ).toBe(false);
  });

  it('validates one component with selectable installation variants', () => {
    const snapshot = cloneExternalLibrarySnapshot({
      id: 'media-subtitles',
      displayName: 'Media subtitles',
      description: 'Complete subtitle suite',
      category: 'media',
      version: '1',
      expectedSize: 100,
      variants: [
        { id: 'cpu', displayName: 'CPU', expectedSize: 100 },
        { id: 'nvidia', displayName: 'NVIDIA', expectedSize: 200 },
      ],
      defaultVariantId: 'cpu',
      installedVariantId: 'nvidia',
      rootPath: '/externalLib',
      status: 'available',
    });

    expect(snapshot.installedVariantId).toBe('nvidia');
    expect(Object.isFrozen(snapshot.variants)).toBe(true);
    expect(
      isExternalLibrarySnapshot({
        ...snapshot,
        installedVariantId: 'unknown',
      }),
    ).toBe(false);
  });
});
