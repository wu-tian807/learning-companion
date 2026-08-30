import type { Stats } from 'node:fs';
import { lstat, mkdir, realpath, rm } from 'node:fs/promises';

import { AppError } from '../../errors/app-error';
import {
  currentPlatformPathRules,
  isPathInside,
  type FileSystemPathRules,
} from '../../filesystem/file-system-path-rules';
import {
  requireAgentWorkspacePathSegment,
  requireAgentWorkspaceRootPath,
} from './agent-workspace-paths';

export interface AgentWorkspaceProjectCleanup {
  removeProject(projectId: string): Promise<void>;
}

export interface AgentWorkspacePreparationApi {
  resolve(segments: readonly string[]): string;
  prepare(segments: readonly string[]): Promise<string>;
}

export interface AgentWorkspaceManagerDependencies {
  readonly lstat: typeof lstat;
  readonly mkdir: typeof mkdir;
  readonly realpath: typeof realpath;
  readonly rm: typeof rm;
  readonly pathRules: FileSystemPathRules;
}

const defaultDependencies: AgentWorkspaceManagerDependencies = {
  lstat,
  mkdir,
  realpath,
  rm,
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

export class AgentWorkspaceManager
  implements AgentWorkspacePreparationApi, AgentWorkspaceProjectCleanup
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
    this.rootPath = requireAgentWorkspaceRootPath(
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
      ...segments.map(requireAgentWorkspacePathSegment),
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

  async removeProject(projectId: string): Promise<void> {
    const projectPath = this.resolve([projectId]);

    try {
      const [rootStats, projectStats] = await Promise.all([
        this.dependencies.lstat(this.rootPath),
        this.dependencies.lstat(projectPath),
      ]);
      this.requireManagedDirectory(rootStats);
      this.requireManagedDirectory(projectStats);

      const [resolvedRootPath, resolvedProjectPath] = await Promise.all([
        this.dependencies.realpath(this.rootPath),
        this.dependencies.realpath(projectPath),
      ]);

      if (
        !isPathInside(
          resolvedRootPath,
          resolvedProjectPath,
          this.dependencies.pathRules,
        )
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      await this.dependencies.rm(projectPath, {
        recursive: true,
        force: true,
      });
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) {
        return;
      }

      throw error;
    }
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
