import { describe, expect, it } from 'vitest';

import {
  externalLibraryStorageSummary,
  formatExternalLibrarySize,
} from './external-library-view';

describe('external library storage presentation', () => {
  it('separates download, installed and recommended-free-space estimates', () => {
    expect(
      externalLibraryStorageSummary({
        expectedSize: 700 * 1024 * 1024,
        estimatedInstalledSize: 2 * 1024 * 1024 * 1024,
        recommendedFreeSpace: 3 * 1024 * 1024 * 1024,
      }),
    ).toBe('下载约 700 MB · 安装后约 2.0 GB · 建议预留 3.0 GB 可用空间');
  });

  it('keeps legacy packages honest when only download size is known', () => {
    expect(
      externalLibraryStorageSummary({ expectedSize: 356 * 1024 * 1024 }),
    ).toBe('下载约 356 MB');
    expect(formatExternalLibrarySize(12 * 1024 * 1024 * 1024)).toBe('12 GB');
  });
});
