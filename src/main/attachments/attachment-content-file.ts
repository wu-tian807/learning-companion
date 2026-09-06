import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import {
  createProjectWorkspaceContentRef,
  type ProjectWorkspaceLocalFileContentRef,
} from '../../shared/assets';
import type { AssetAttachmentContent } from '../../shared/attachments/contracts';
import { AppError } from '../errors/app-error';
import type { ProjectLookup } from '../projects/project-database';
import {
  PROJECT_WORKSPACE_METADATA_DIRECTORY,
  resolvePortableWorkspacePath,
  isPathInside,
} from '../projects/project-workspace-paths';

const ATTACHMENT_DIRECTORY =
  `${PROJECT_WORKSPACE_METADATA_DIRECTORY}/attachments`;

function requireSegment(value: string, field: string): string {
  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized !== value ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized === '.' ||
    normalized === '..'
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR', {
      cause: new Error(`Attachment ${field} 无效`),
    });
  }

  return normalized;
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export interface WriteAttachmentContentInput {
  readonly projectId: string;
  readonly attachmentId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly content: string | Uint8Array;
}

/** Generic file lifecycle for Attachment-owned project workspace content. */
export class AttachmentContentFile {
  constructor(private readonly projects: ProjectLookup) {}

  async write(
    input: WriteAttachmentContentInput,
  ): Promise<AssetAttachmentContent> {
    const project = this.requireProject(input.projectId);
    const attachmentId = requireSegment(input.attachmentId, 'id');
    const fileName = requireSegment(input.fileName, 'fileName');
    const mediaType = input.mediaType.trim();

    if (!mediaType) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const relativePath =
      `${ATTACHMENT_DIRECTORY}/${attachmentId}/${fileName}`;
    const absolutePath = resolvePortableWorkspacePath(
      project.workspacePath,
      relativePath,
    );
    await mkdir(dirname(absolutePath), { recursive: true });
    const content =
      typeof input.content === 'string'
        ? input.content
        : Buffer.from(input.content);
    await writeFileAtomic(absolutePath, content, {
      ...(typeof input.content === 'string' ? { encoding: 'utf8' } : {}),
    });

    return Object.freeze({
      ref: createProjectWorkspaceContentRef(relativePath),
      mediaType,
    });
  }

  async readText(
    projectId: string,
    ref: ProjectWorkspaceLocalFileContentRef,
  ): Promise<string | undefined> {
    const project = this.requireProject(projectId);
    const absolutePath = resolvePortableWorkspacePath(
      project.workspacePath,
      ref.path,
    );

    try {
      return await readFile(absolutePath, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async removeAttachment(
    projectId: string,
    attachmentId: string,
  ): Promise<void> {
    const project = this.requireProject(projectId);
    const relativePath = `${ATTACHMENT_DIRECTORY}/${requireSegment(
      attachmentId,
      'id',
    )}`;
    await rm(
      resolvePortableWorkspacePath(project.workspacePath, relativePath),
      { recursive: true, force: true },
    );
  }

  async removeContent(
    projectId: string,
    attachmentId: string,
    ref: ProjectWorkspaceLocalFileContentRef,
  ): Promise<void> {
    const project = this.requireProject(projectId);
    const absolutePath = resolvePortableWorkspacePath(
      project.workspacePath,
      ref.path,
    );
    const ownedDirectory = resolvePortableWorkspacePath(
      project.workspacePath,
      `${ATTACHMENT_DIRECTORY}/${requireSegment(attachmentId, 'id')}`,
    );
    // Replacing a reference transfers no ownership of linked originals.
    if (!isPathInside(ownedDirectory, absolutePath)) return;
    try {
      const physicalWorkspace = await realpath(project.workspacePath);
      const physicalOwnedDirectory = resolvePortableWorkspacePath(
        physicalWorkspace,
        `${ATTACHMENT_DIRECTORY}/${requireSegment(attachmentId, 'id')}`,
      );
      // A junction must not turn an owned-looking ref into another owner's file.
      if (!isPathInside(physicalOwnedDirectory, await realpath(absolutePath))) return;
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
    await rm(absolutePath, { force: true });
  }

  private requireProject(projectId: string) {
    const project = this.projects.get(projectId.trim());

    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    return project;
  }
}
