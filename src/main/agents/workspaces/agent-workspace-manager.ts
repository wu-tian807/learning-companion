import type { Stats } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';

import { AppError } from '../../errors/app-error';
import {
  currentPlatformPathRules,
  isPathInside,
  type FileSystemPathRules,
} from '../../filesystem/file-system-path-rules';

const invalidPortableSegmentCharacters = /[<>:"/\\|?*]/u;
const windowsReservedDeviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export interface AgentWorkspaceManagerApi {
  resolve(segments: readonly string[]): string;
  prepare(segments: readonly string[]): Promise<string>;
}

export interface AgentWorkspaceManagerDependencies {
  readonly lstat: typeof lstat;
  readonly mkdir: typeof mkdir;
  readonly realpath: typeof realpath;
  readonly pathRules: FileSystemPathRules;
}

const defaultDependencies: AgentWorkspaceManagerDependencies = {
  lstat,
  mkdir,
  realpath,
  pathRules: currentPlatformPathRules,
};

function isFileSystemError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function requireRootPath(
  rootPath: string,
  pathRules: FileSystemPathRules,
): string {
  const normalized = pathRules.normalize(rootPath.trim());

  if (
    normalized.length === 0 ||
    !pathRules.isAbsolute(normalized) ||
    normalized === pathRules.parse(normalized).root
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

function requirePortablePathSegment(segment: string): string {
  const containsControlCharacter = [...segment].some(
    (character) => character.codePointAt(0)! < 0x20,
  );

  if (
    segment.length === 0 ||
    segment.trim() !== segment ||
    segment === '.' ||
    segment === '..' ||
    segment.endsWith('.') ||
    containsControlCharacter ||
    invalidPortableSegmentCharacters.test(segment) ||
    windowsReservedDeviceName.test(segment)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return segment;
}

export class AgentWorkspaceManager
  implements AgentWorkspaceManagerApi
{
  private readonly dependencies: AgentWorkspaceManagerDependencies;
  private readonly rootPath: string;

  constructor(
    rootPath: string,
    dependencies: Partial<AgentWorkspaceManagerDependencies> = {},
  ) {
    this.dependencies = {
      ...defaultDependencies,
      ...dependencies,
    };
    this.rootPath = requireRootPath(
      rootPath,
      this.dependencies.pathRules,
    );
  }

  resolve(segments: readonly string[]): string {
    if (segments.length === 0) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const candidate = this.dependencies.pathRules.resolve(
      this.rootPath,
      ...segments.map(requirePortablePathSegment),
    );

    if (!isPathInside(this.rootPath, candidate, this.dependencies.pathRules)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return candidate;
  }

  async prepare(segments: readonly string[]): Promise<string> {
    const segmentSnapshot = [...segments];
    const workspacePath = this.resolve(segmentSnapshot);
    await this.dependencies.mkdir(this.rootPath, { recursive: true });
    const rootStats = await this.dependencies.lstat(this.rootPath);

    this.requireManagedDirectory(rootStats);

    const resolvedRootPath = await this.dependencies.realpath(
      this.rootPath,
    );
    let currentPath = this.rootPath;

    for (const segment of segmentSnapshot) {
      currentPath = this.dependencies.pathRules.join(
        currentPath,
        segment,
      );
      const stats = await this.ensureDirectory(currentPath);

      this.requireManagedDirectory(stats);

      const resolvedCurrentPath = await this.dependencies.realpath(
        currentPath,
      );

      if (
        !isPathInside(
          resolvedRootPath,
          resolvedCurrentPath,
          this.dependencies.pathRules,
        )
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
    }

    return workspacePath;
  }

  private async ensureDirectory(path: string): Promise<Stats> {
    try {
      return await this.dependencies.lstat(path);
    } catch (error) {
      if (!isFileSystemError(error, 'ENOENT')) {
        throw error;
      }
    }

    try {
      await this.dependencies.mkdir(path);
    } catch (error) {
      if (!isFileSystemError(error, 'EEXIST')) {
        throw error;
      }
    }

    return this.dependencies.lstat(path);
  }

  private requireManagedDirectory(stats: Stats): void {
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
  }
}
