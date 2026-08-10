import type { Stats } from 'node:fs';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';

import writeFileAtomic from 'write-file-atomic';

import { AppError } from '../../errors/app-error';
import {
  currentPlatformPathRules,
  isPathInside,
  type FileSystemPathRules,
} from '../../filesystem/file-system-path-rules';
import { PROJECT_WORKSPACE_METADATA_DIRECTORY } from '../../projects/project-workspace-paths';
import { AgentWorkspaceManager } from '../workspaces/agent-workspace-manager';
import { requireAgentWorkspaceRootPath } from '../workspaces/agent-workspace-paths';
import {
  AgentSession,
  areAgentSessionLocatorsEqual,
  cloneAgentSessionSnapshot,
  createAgentSessionLocator,
  type AgentSessionLocator,
  type AgentSessionSnapshot,
} from './agent-session';

export const AGENT_SESSION_METADATA_DIRECTORY = 'agent-sessions';
export const AGENT_SESSION_FILE_NAME = 'session.json';
export const AGENT_SESSION_FILE_FORMAT =
  'learning-companion/agent-session';
export const AGENT_SESSION_FILE_VERSION = 2;

const LEGACY_AGENT_SESSION_FILE_VERSION = 1;

export interface AgentSessionFileApi {
  read(
    locator: AgentSessionLocator,
  ): Promise<AgentSessionSnapshot | undefined>;
  write(snapshot: AgentSessionSnapshot): Promise<void>;
}

interface AgentSessionFileDependencies {
  readonly lstat: typeof lstat;
  readonly mkdir: typeof mkdir;
  readonly readFile: typeof readFile;
  readonly realpath: typeof realpath;
  readonly writeFileAtomic: typeof writeFileAtomic;
  readonly pathRules: FileSystemPathRules;
}

interface AgentSessionFileDocument extends AgentSessionSnapshot {
  readonly format: typeof AGENT_SESSION_FILE_FORMAT;
  readonly version: typeof AGENT_SESSION_FILE_VERSION;
}

const defaultDependencies: AgentSessionFileDependencies = {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFileAtomic,
  pathRules: currentPlatformPathRules,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function requireDirectory(stats: Stats): void {
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
}

function requireRegularFile(stats: Stats): void {
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
}

export class AgentSessionFile implements AgentSessionFileApi {
  private readonly dependencies: AgentSessionFileDependencies;
  private readonly projectWorkspacePath: string;
  private readonly workspaceManager: AgentWorkspaceManager;

  constructor(
    projectWorkspacePath: string,
    dependencies: Partial<AgentSessionFileDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
    this.projectWorkspacePath = requireAgentWorkspaceRootPath(
      projectWorkspacePath,
      this.dependencies.pathRules,
    );
    this.workspaceManager = new AgentWorkspaceManager(
      this.projectWorkspacePath,
      {
        lstat: this.dependencies.lstat,
        mkdir: this.dependencies.mkdir,
        realpath: this.dependencies.realpath,
        pathRules: this.dependencies.pathRules,
      },
    );
  }

  resolve(locator: AgentSessionLocator): string {
    const normalized = createAgentSessionLocator(locator);
    return this.dependencies.pathRules.join(
      this.workspaceManager.resolve(this.segments(normalized)),
      AGENT_SESSION_FILE_NAME,
    );
  }

  async read(
    locator: AgentSessionLocator,
  ): Promise<AgentSessionSnapshot | undefined> {
    const normalized = createAgentSessionLocator(locator);
    const filePath = await this.resolveExistingFile(normalized);

    if (!filePath) {
      return undefined;
    }

    let value: unknown;

    try {
      value = JSON.parse(
        await this.dependencies.readFile(filePath, 'utf8'),
      );
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) {
        return undefined;
      }

      if (error instanceof SyntaxError) {
        throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
      }

      throw error;
    }

    if (
      !isRecord(value) ||
      value.format !== AGENT_SESSION_FILE_FORMAT ||
      (value.version !== LEGACY_AGENT_SESSION_FILE_VERSION &&
        value.version !== AGENT_SESSION_FILE_VERSION)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const snapshot = new AgentSession(
      value as unknown as AgentSessionSnapshot,
    ).getSnapshot();

    if (!areAgentSessionLocatorsEqual(snapshot.locator, normalized)) {
      throw new AppError('AGENT_SESSION_CONFLICT');
    }

    return snapshot;
  }

  async write(snapshot: AgentSessionSnapshot): Promise<void> {
    const normalized = cloneAgentSessionSnapshot(snapshot);
    await this.requireProjectWorkspaceRoot();
    const directoryPath = await this.workspaceManager.prepare(
      this.segments(normalized.locator),
    );
    const filePath = this.dependencies.pathRules.join(
      directoryPath,
      AGENT_SESSION_FILE_NAME,
    );

    try {
      requireRegularFile(await this.dependencies.lstat(filePath));
    } catch (error) {
      if (!isFileSystemError(error, 'ENOENT')) {
        throw error;
      }
    }

    const document: AgentSessionFileDocument = Object.freeze({
      format: AGENT_SESSION_FILE_FORMAT,
      version: AGENT_SESSION_FILE_VERSION,
      ...normalized,
    });

    await this.dependencies.writeFileAtomic(
      filePath,
      `${JSON.stringify(document, undefined, 2)}\n`,
      { encoding: 'utf8' },
    );
  }

  private segments(
    locator: AgentSessionLocator,
  ): readonly string[] {
    return Object.freeze([
      PROJECT_WORKSPACE_METADATA_DIRECTORY,
      AGENT_SESSION_METADATA_DIRECTORY,
      locator.workspaceKey,
      locator.instanceKey,
    ]);
  }

  private async resolveExistingFile(
    locator: AgentSessionLocator,
  ): Promise<string | undefined> {
    const resolvedRootPath = await this.requireProjectWorkspaceRoot();
    let currentPath = this.projectWorkspacePath;

    for (const segment of this.segments(locator)) {
      currentPath = this.dependencies.pathRules.join(
        currentPath,
        segment,
      );

      let stats: Stats;

      try {
        stats = await this.dependencies.lstat(currentPath);
      } catch (error) {
        if (isFileSystemError(error, 'ENOENT')) {
          return undefined;
        }

        throw error;
      }

      requireDirectory(stats);
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

    const filePath = this.dependencies.pathRules.join(
      currentPath,
      AGENT_SESSION_FILE_NAME,
    );

    let fileStats: Stats;

    try {
      fileStats = await this.dependencies.lstat(filePath);
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) {
        return undefined;
      }

      throw error;
    }

    requireRegularFile(fileStats);
    const resolvedFilePath = await this.dependencies.realpath(filePath);

    if (
      !isPathInside(
        resolvedRootPath,
        resolvedFilePath,
        this.dependencies.pathRules,
      )
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return filePath;
  }

  private async requireProjectWorkspaceRoot(): Promise<string> {
    let stats: Stats;

    try {
      stats = await this.dependencies.lstat(this.projectWorkspacePath);
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) {
        throw new AppError('PROJECT_WORKSPACE_UNAVAILABLE', {
          cause: error,
        });
      }

      throw error;
    }

    requireDirectory(stats);
    return this.dependencies.realpath(this.projectWorkspacePath);
  }
}
