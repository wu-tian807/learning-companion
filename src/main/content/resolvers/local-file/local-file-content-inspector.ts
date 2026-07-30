import { constants, type Stats } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';

import {
  createAssetContentStatus,
  type AssetAvailability,
  type AssetContentStatus,
} from '../../../../shared/assets';

export type LocalFileAvailability = AssetAvailability;

export interface LocalFileContentInspection {
  readonly absolutePath: string;
  readonly contentStatus: AssetContentStatus;
}

export interface LocalFileContentInspectionInput {
  readonly path: string;
  readonly availability: LocalFileAvailability;
  readonly checkedTime: number;
}

export interface LocalFileContentInspector {
  inspect(path: string): Promise<LocalFileContentInspection>;
}

export interface LocalFileContentInspectorDependencies {
  readonly stat: (path: string) => Promise<Stats>;
  readonly access: (path: string) => Promise<void>;
  readonly now: () => number;
}

const defaultDependencies: LocalFileContentInspectorDependencies = {
  stat,
  access: (path) => access(path, constants.R_OK),
  now: Date.now,
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

export function createLocalFileContentInspection(
  input: LocalFileContentInspectionInput,
): LocalFileContentInspection {
  return Object.freeze({
    absolutePath: normalizeLocalFilePath(input.path),
    contentStatus: createAssetContentStatus(
      input.availability,
      input.checkedTime,
    ),
  });
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

export class DefaultLocalFileContentInspector
  implements LocalFileContentInspector
{
  private readonly dependencies: LocalFileContentInspectorDependencies;

  constructor(
    dependencies: Partial<LocalFileContentInspectorDependencies> = {},
  ) {
    this.dependencies = {
      ...defaultDependencies,
      ...dependencies,
    };
  }

  async inspect(path: string): Promise<LocalFileContentInspection> {
    const normalizedPath = normalizeLocalFilePath(path);
    const checkedTime = this.dependencies.now();

    try {
      const fileStats = await this.dependencies.stat(normalizedPath);

      if (!fileStats.isFile()) {
        return createLocalFileContentInspection({
          path: normalizedPath,
          availability: 'invalid',
          checkedTime,
        });
      }

      await this.dependencies.access(normalizedPath);

      return createLocalFileContentInspection({
        path: normalizedPath,
        availability: 'available',
        checkedTime,
      });
    } catch (error) {
      return createLocalFileContentInspection({
        path: normalizedPath,
        availability: availabilityFromError(error),
        checkedTime,
      });
    }
  }
}
