import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import {
  access,
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  join,
  relative,
} from 'node:path';

import { dialog, shell } from 'electron';

import {
  createAbsoluteLocalFileContentRef,
  createProjectWorkspaceContentRef,
  type LocalFileContentRef,
} from '../../shared/assets';
import { AppError } from '../errors/app-error';
import {
  InMemoryFileDialogLastDirectoryCache,
  type FileDialogLastDirectoryCacheApi,
} from '../filesystem/file-dialog-last-directory-cache';
import {
  createConflictFreeFileName,
  isPathInside,
  PROJECT_WORKSPACE_METADATA_DIRECTORY,
  requireAbsoluteWorkspaceDirectoryPath,
  requireAbsoluteWorkspaceFilePath,
  resolvePortableWorkspacePath,
  sanitizeProjectDirectoryName,
  toPortableRelativePath,
} from './project-workspace-paths';

export {
  createDefaultProjectWorkspaceRoot,
  isPathInside,
  PROJECT_WORKSPACE_METADATA_DIRECTORY,
  resolvePortableWorkspacePath,
  toPortableRelativePath,
} from './project-workspace-paths';

export const PROJECT_WORKSPACE_SCHEMA_VERSION = 1;
export const PROJECT_WORKSPACE_MARKER_FILE = 'workspace.json';

export interface WorkspacePreparation {
  readonly workspacePath: string;
  readonly createdWorkspaceDirectory: boolean;
  readonly createdMarker: boolean;
}

export interface ImportedLocalFile {
  readonly contentRef: LocalFileContentRef;
  readonly copiedAbsolutePath?: string;
}

interface WorkspaceMarker {
  readonly schemaVersion: number;
  readonly projectId: string;
}

export interface ProjectWorkspaceManagerApi {
  createDefaultWorkspacePath(
    defaultWorkspaceRoot: string,
    projectId: string,
    projectName: string,
  ): Promise<string>;
  prepareWorkspace(input: {
    readonly projectId: string;
    readonly workspacePath: string;
  }): Promise<WorkspacePreparation>;
  validateWorkspace(input: {
    readonly projectId: string;
    readonly workspacePath: string;
  }): Promise<void>;
  rollbackPreparation(preparation: WorkspacePreparation): Promise<void>;
  selectWorkspace(defaultPath: string): Promise<string | undefined>;
  selectAssetFiles(workspacePath: string): Promise<readonly string[]>;
  classifyLocalFile(
    workspacePath: string,
    absolutePath: string,
  ): Promise<LocalFileContentRef>;
  resolveLocalFile(
    workspacePath: string,
    ref: LocalFileContentRef,
  ): Promise<string>;
  copyImportedFile(
    workspacePath: string,
    sourcePath: string,
  ): Promise<ImportedLocalFile>;
  removeImportedFile(absolutePath: string): Promise<void>;
  openWorkspace(workspacePath: string): Promise<void>;
  revealFile(absolutePath: string): void;
}

export interface ProjectWorkspaceManagerDependencies {
  readonly access: typeof access;
  readonly copyFile: typeof copyFile;
  readonly link: typeof link;
  readonly lstat: typeof lstat;
  readonly mkdir: typeof mkdir;
  readonly readFile: typeof readFile;
  readonly realpath: typeof realpath;
  readonly rm: typeof rm;
  readonly stat: typeof stat;
  readonly writeFile: typeof writeFile;
  readonly createId: () => string;
  readonly fileDialogLastDirectoryCache: FileDialogLastDirectoryCacheApi;
  readonly showOpenDialog: typeof dialog.showOpenDialog;
  readonly openPath: typeof shell.openPath;
  readonly showItemInFolder: typeof shell.showItemInFolder;
}

const defaultDependencies: Omit<
  ProjectWorkspaceManagerDependencies,
  'fileDialogLastDirectoryCache'
> = {
  access,
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
  createId: randomUUID,
  showOpenDialog: (options) => dialog.showOpenDialog(options),
  openPath: (path) => shell.openPath(path),
  showItemInFolder: (path) => shell.showItemInFolder(path),
};

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ((error as NodeJS.ErrnoException).code === 'ENOENT' ||
      (error as NodeJS.ErrnoException).code === 'ENOTDIR')
  );
}

function createMarkerContent(projectId: string): string {
  return `${JSON.stringify(
    {
      schemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
      projectId,
    } satisfies WorkspaceMarker,
    null,
    2,
  )}\n`;
}

function parseMarker(content: string): WorkspaceMarker {
  const value: unknown = JSON.parse(content);

  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== PROJECT_WORKSPACE_SCHEMA_VERSION ||
    !('projectId' in value) ||
    typeof value.projectId !== 'string' ||
    value.projectId.trim().length === 0
  ) {
    throw new AppError('PROJECT_WORKSPACE_CONFLICT');
  }

  return {
    schemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
    projectId: value.projectId.trim(),
  };
}

export class ProjectWorkspaceManager
  implements ProjectWorkspaceManagerApi
{
  private readonly dependencies: ProjectWorkspaceManagerDependencies;

  constructor(
    dependencies: Partial<ProjectWorkspaceManagerDependencies> = {},
  ) {
    this.dependencies = {
      ...defaultDependencies,
      ...dependencies,
      fileDialogLastDirectoryCache:
        dependencies.fileDialogLastDirectoryCache ??
        new InMemoryFileDialogLastDirectoryCache(),
    };
  }

  async createDefaultWorkspacePath(
    defaultWorkspaceRoot: string,
    projectId: string,
    projectName: string,
  ): Promise<string> {
    const root = requireAbsoluteWorkspaceDirectoryPath(
      defaultWorkspaceRoot,
    );
    const directoryName = sanitizeProjectDirectoryName(projectName);

    for (let suffix = 1; suffix <= 10_000; suffix += 1) {
      const candidate = join(
        root,
        suffix === 1 ? directoryName : `${directoryName} (${suffix})`,
      );

      try {
        const marker = await this.readMarker(candidate);

        if (marker?.projectId === projectId) {
          return candidate;
        }

        await this.dependencies.lstat(candidate);
      } catch (error) {
        if (isFileNotFoundError(error)) {
          return candidate;
        }

        if (
          error instanceof AppError &&
          error.code === 'PROJECT_WORKSPACE_CONFLICT'
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new AppError('PROJECT_WORKSPACE_UNAVAILABLE');
  }

  async prepareWorkspace(input: {
    readonly projectId: string;
    readonly workspacePath: string;
  }): Promise<WorkspacePreparation> {
    const projectId = input.projectId.trim();
    const workspacePath = requireAbsoluteWorkspaceDirectoryPath(
      input.workspacePath,
    );

    if (projectId.length === 0) {
      throw new AppError('INVALID_IPC_REQUEST');
    }

    let createdWorkspaceDirectory = false;
    let createdMarker = false;

    try {
      let workspaceStats: Stats;

      try {
        workspaceStats = await this.dependencies.stat(workspacePath);
      } catch (error) {
        if (!isFileNotFoundError(error)) {
          throw error;
        }

        await this.dependencies.mkdir(workspacePath, { recursive: true });
        createdWorkspaceDirectory = true;
        workspaceStats = await this.dependencies.stat(workspacePath);
      }

      if (!workspaceStats.isDirectory()) {
        throw new AppError('PROJECT_WORKSPACE_UNAVAILABLE');
      }

      await this.dependencies.access(
        workspacePath,
        constants.R_OK | constants.W_OK,
      );

      const currentMarker = await this.readMarker(workspacePath);

      if (currentMarker && currentMarker.projectId !== projectId) {
        throw new AppError('PROJECT_WORKSPACE_CONFLICT');
      }

      await Promise.all([
        this.dependencies.mkdir(
          join(workspacePath, 'assets', 'imported'),
          { recursive: true },
        ),
        this.dependencies.mkdir(
          join(workspacePath, 'assets', 'generated'),
          { recursive: true },
        ),
        this.dependencies.mkdir(join(workspacePath, 'attachments'), {
          recursive: true,
        }),
        this.dependencies.mkdir(
          join(workspacePath, PROJECT_WORKSPACE_METADATA_DIRECTORY),
          { recursive: true },
        ),
      ]);

      if (!currentMarker) {
        const markerPath = this.markerPath(workspacePath);
        const temporaryMarkerPath = `${markerPath}.${this.dependencies.createId()}.tmp`;

        try {
          await this.dependencies.writeFile(
            temporaryMarkerPath,
            createMarkerContent(projectId),
            { encoding: 'utf8', flag: 'wx' },
          );
          await this.dependencies.link(temporaryMarkerPath, markerPath);
          createdMarker = true;
        } catch (error) {
          if (
            error instanceof Error &&
            'code' in error &&
            (error as NodeJS.ErrnoException).code === 'EEXIST'
          ) {
            const concurrentMarker = await this.readMarker(workspacePath);

            if (concurrentMarker?.projectId !== projectId) {
              throw new AppError('PROJECT_WORKSPACE_CONFLICT', {
                cause: error,
              });
            }
          } else {
            throw error;
          }
        } finally {
          await this.dependencies.rm(temporaryMarkerPath, {
            force: true,
          });
        }
      }

      return Object.freeze({
        workspacePath,
        createdWorkspaceDirectory,
        createdMarker,
      });
    } catch (error) {
      if (createdWorkspaceDirectory) {
        await this.dependencies
          .rm(workspacePath, { recursive: true, force: true })
          .catch(() => undefined);
      }

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('PROJECT_WORKSPACE_UNAVAILABLE', { cause: error });
    }
  }

  async validateWorkspace(input: {
    readonly projectId: string;
    readonly workspacePath: string;
  }): Promise<void> {
    const projectId = input.projectId.trim();
    const workspacePath = requireAbsoluteWorkspaceDirectoryPath(
      input.workspacePath,
    );

    if (projectId.length === 0) {
      throw new AppError('INVALID_IPC_REQUEST');
    }

    try {
      const workspaceStats = await this.dependencies.stat(workspacePath);

      if (!workspaceStats.isDirectory()) {
        throw new AppError('PROJECT_WORKSPACE_UNAVAILABLE');
      }

      await this.dependencies.access(
        workspacePath,
        constants.R_OK | constants.W_OK,
      );
      const marker = await this.readMarker(workspacePath);

      if (!marker || marker.projectId !== projectId) {
        throw new AppError('PROJECT_WORKSPACE_CONFLICT');
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('PROJECT_WORKSPACE_UNAVAILABLE', { cause: error });
    }
  }

  async rollbackPreparation(
    preparation: WorkspacePreparation,
  ): Promise<void> {
    if (preparation.createdWorkspaceDirectory) {
      await this.dependencies.rm(preparation.workspacePath, {
        recursive: true,
        force: true,
      });
      return;
    }

    if (preparation.createdMarker) {
      await this.dependencies.rm(this.markerPath(preparation.workspacePath), {
        force: true,
      });
    }
  }

  async selectWorkspace(defaultPath: string): Promise<string | undefined> {
    const result = await this.dependencies.showOpenDialog({
      defaultPath: requireAbsoluteWorkspaceDirectoryPath(defaultPath),
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }

    return requireAbsoluteWorkspaceDirectoryPath(result.filePaths[0]!);
  }

  async selectAssetFiles(
    workspacePath: string,
  ): Promise<readonly string[]> {
    const normalizedWorkspace =
      requireAbsoluteWorkspaceDirectoryPath(workspacePath);
    const cacheScope = `project-assets:${normalizedWorkspace}`;
    const result = await this.dependencies.showOpenDialog({
      defaultPath:
        this.dependencies.fileDialogLastDirectoryCache.get(cacheScope) ??
        normalizedWorkspace,
      properties: ['openFile', 'multiSelections'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    const selectedFiles = result.filePaths.map((path) =>
      requireAbsoluteWorkspaceFilePath(path),
    );
    this.dependencies.fileDialogLastDirectoryCache.remember(
      cacheScope,
      dirname(selectedFiles[0]!),
    );
    return selectedFiles;
  }

  async classifyLocalFile(
    workspacePath: string,
    absolutePath: string,
  ): Promise<LocalFileContentRef> {
    const normalizedWorkspace =
      requireAbsoluteWorkspaceDirectoryPath(workspacePath);
    const normalizedFile =
      requireAbsoluteWorkspaceFilePath(absolutePath);
    const realFile = await this.dependencies.realpath(normalizedFile);
    let realWorkspace: string;

    try {
      realWorkspace = await this.dependencies.realpath(
        normalizedWorkspace,
      );
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return createAbsoluteLocalFileContentRef(normalizedFile);
      }

      throw error;
    }

    if (!isPathInside(realWorkspace, realFile)) {
      return createAbsoluteLocalFileContentRef(normalizedFile);
    }

    return createProjectWorkspaceContentRef(
      toPortableRelativePath(relative(realWorkspace, realFile)),
    );
  }

  async resolveLocalFile(
    workspacePath: string,
    ref: LocalFileContentRef,
  ): Promise<string> {
    if (ref.base === 'absolute') {
      return requireAbsoluteWorkspaceFilePath(ref.path);
    }

    const normalizedWorkspace =
      requireAbsoluteWorkspaceDirectoryPath(workspacePath);
    const candidate = resolvePortableWorkspacePath(
      normalizedWorkspace,
      ref.path,
    );

    try {
      const [realWorkspace, realCandidate] = await Promise.all([
        this.dependencies.realpath(normalizedWorkspace),
        this.dependencies.realpath(candidate),
      ]);

      if (!isPathInside(realWorkspace, realCandidate)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      return realCandidate;
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return candidate;
      }

      if (error instanceof AppError) {
        throw error;
      }

      return candidate;
    }
  }

  async copyImportedFile(
    workspacePath: string,
    sourcePath: string,
  ): Promise<ImportedLocalFile> {
    const normalizedWorkspace =
      requireAbsoluteWorkspaceDirectoryPath(workspacePath);
    const normalizedSource =
      requireAbsoluteWorkspaceFilePath(sourcePath);
    const classified = await this.classifyLocalFile(
      normalizedWorkspace,
      normalizedSource,
    );

    if (classified.base === 'project-workspace') {
      return Object.freeze({ contentRef: classified });
    }

    const importedDirectory = join(
      normalizedWorkspace,
      'assets',
      'imported',
    );
    await this.dependencies.mkdir(importedDirectory, { recursive: true });
    const originalName = basename(normalizedSource);
    let destinationPath: string | undefined;

    for (let suffix = 1; suffix <= 10_000; suffix += 1) {
      const candidate = join(
        importedDirectory,
        createConflictFreeFileName(originalName, suffix),
      );

      try {
        await this.dependencies.lstat(candidate);
      } catch (error) {
        if (isFileNotFoundError(error)) {
          destinationPath = candidate;
          break;
        }

        throw error;
      }
    }

    if (!destinationPath) {
      throw new AppError('FILE_IMPORT_FAILED');
    }

    const temporaryPath = join(
      importedDirectory,
      `.${this.dependencies.createId()}.importing`,
    );

    try {
      await this.dependencies.copyFile(
        normalizedSource,
        temporaryPath,
        constants.COPYFILE_EXCL,
      );
      await this.dependencies.link(temporaryPath, destinationPath);
      await this.dependencies.rm(temporaryPath, { force: true });

      return Object.freeze({
        contentRef: await this.classifyLocalFile(
          normalizedWorkspace,
          destinationPath,
        ),
        copiedAbsolutePath: destinationPath,
      });
    } catch (error) {
      await Promise.all([
        this.dependencies.rm(temporaryPath, { force: true }),
        this.dependencies.rm(destinationPath, { force: true }),
      ]).catch(() => undefined);
      throw new AppError('FILE_IMPORT_FAILED', { cause: error });
    }
  }

  async removeImportedFile(absolutePath: string): Promise<void> {
    await this.dependencies.rm(
      requireAbsoluteWorkspaceFilePath(absolutePath),
      {
      force: true,
      },
    );
  }

  async openWorkspace(workspacePath: string): Promise<void> {
    const normalizedWorkspace =
      requireAbsoluteWorkspaceDirectoryPath(workspacePath);
    const errorMessage = await this.dependencies.openPath(normalizedWorkspace);

    if (errorMessage.length > 0) {
      throw new AppError('PROJECT_WORKSPACE_UNAVAILABLE', {
        cause: new Error(errorMessage),
      });
    }
  }

  revealFile(absolutePath: string): void {
    this.dependencies.showItemInFolder(
      requireAbsoluteWorkspaceFilePath(absolutePath),
    );
  }

  private markerPath(workspacePath: string): string {
    return join(
      workspacePath,
      PROJECT_WORKSPACE_METADATA_DIRECTORY,
      PROJECT_WORKSPACE_MARKER_FILE,
    );
  }

  private async readMarker(
    workspacePath: string,
  ): Promise<WorkspaceMarker | undefined> {
    try {
      return parseMarker(
        await this.dependencies.readFile(
          this.markerPath(workspacePath),
          'utf8',
        ),
      );
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return undefined;
      }

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('PROJECT_WORKSPACE_CONFLICT', { cause: error });
    }
  }
}
