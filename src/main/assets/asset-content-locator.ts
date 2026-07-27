import { constants, type Stats } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';

import {
  LOCAL_FILE_CONTENT_KIND,
  type AssetContentAvailability,
} from '../content/content-ref';

export { LOCAL_FILE_CONTENT_KIND };

export type LocalFileAvailability = AssetContentAvailability;

export interface LocalFileContentLocator {
  readonly kind: typeof LOCAL_FILE_CONTENT_KIND;
  readonly path: string;
  readonly availability: LocalFileAvailability;
  readonly checkedTime: Date;
}

export interface LocalFileContentLocatorInput {
  readonly path: string;
  readonly availability: LocalFileAvailability;
  readonly checkedTime: Date;
}

export interface LocalFileLocatorChecker {
  check(path: string): Promise<LocalFileContentLocator>;
}

export interface LocalFileLocatorCheckerDependencies {
  readonly stat: (path: string) => Promise<Stats>;
  readonly access: (path: string) => Promise<void>;
  readonly now: () => Date;
}

const availabilityValues = new Set<LocalFileAvailability>([
  'available',
  'missing',
  'inaccessible',
  'invalid',
]);

const defaultDependencies: LocalFileLocatorCheckerDependencies = {
  stat,
  access: (path) => access(path, constants.R_OK),
  now: () => new Date(),
};

export function normalizeLocalFilePath(path: string): string {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new Error('Asset 本地文件路径不能为空');
  }

  if (!isAbsolute(path)) {
    throw new Error('Asset 本地文件路径必须是绝对路径');
  }

  return normalize(path);
}

export function createLocalFileContentLocator(
  input: LocalFileContentLocatorInput,
): LocalFileContentLocator {
  if (!availabilityValues.has(input.availability)) {
    throw new Error('Asset 本地文件可用状态无效');
  }

  if (Number.isNaN(input.checkedTime.getTime())) {
    throw new Error('Asset checkedTime 必须是有效日期');
  }

  return Object.freeze({
    kind: LOCAL_FILE_CONTENT_KIND,
    path: normalizeLocalFilePath(input.path),
    availability: input.availability,
    checkedTime: new Date(input.checkedTime.getTime()),
  });
}

export function cloneLocalFileContentLocator(
  locator: LocalFileContentLocator,
): LocalFileContentLocator {
  return createLocalFileContentLocator(locator);
}

function getFileSystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

function availabilityFromError(error: unknown): LocalFileAvailability {
  const code = getFileSystemErrorCode(error);

  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return 'missing';
  }

  return 'inaccessible';
}

export class DefaultLocalFileLocatorChecker
  implements LocalFileLocatorChecker
{
  private readonly dependencies: LocalFileLocatorCheckerDependencies;

  constructor(
    dependencies: Partial<LocalFileLocatorCheckerDependencies> = {},
  ) {
    this.dependencies = {
      ...defaultDependencies,
      ...dependencies,
    };
  }

  async check(path: string): Promise<LocalFileContentLocator> {
    const normalizedPath = normalizeLocalFilePath(path);
    const checkedTime = this.dependencies.now();

    try {
      const fileStats = await this.dependencies.stat(normalizedPath);

      if (!fileStats.isFile()) {
        return createLocalFileContentLocator({
          path: normalizedPath,
          availability: 'invalid',
          checkedTime,
        });
      }

      await this.dependencies.access(normalizedPath);

      return createLocalFileContentLocator({
        path: normalizedPath,
        availability: 'available',
        checkedTime,
      });
    } catch (error) {
      return createLocalFileContentLocator({
        path: normalizedPath,
        availability: availabilityFromError(error),
        checkedTime,
      });
    }
  }
}
