import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import {
  createProjectWorkspaceContentRef,
  type ProjectWorkspaceLocalFileContentRef,
} from '../../shared/assets';
import type { AssetAttachmentContent } from '../../shared/workbench/attachment';
import { AppError } from '../errors/app-error';
import type { ProjectLookup } from '../projects/project-database';
import { resolvePortableWorkspacePath } from '../projects/project-workspace-manager';

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

export class AttachmentFileManager {
  constructor(private readonly projects: ProjectLookup) {}

  async writeMarkdown(
    projectId: string,
    attachmentId: string,
    markdown: string,
  ): Promise<AssetAttachmentContent> {
    const project = this.requireProject(projectId);
    const id = requireSegment(attachmentId, 'id');
    const relativePath = `attachments/${id}/answer.md`;
    const absolutePath = resolvePortableWorkspacePath(
      project.workspacePath,
      relativePath,
    );
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFileAtomic(absolutePath, `${markdown.trim()}\n`, {
      encoding: 'utf8',
    });

    return Object.freeze({
      ref: createProjectWorkspaceContentRef(relativePath),
      mediaType: 'text/markdown',
    });
  }

  async readMarkdown(
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

  async delete(projectId: string, attachmentId: string): Promise<void> {
    const project = this.requireProject(projectId);
    const directory = join(
      project.workspacePath,
      'attachments',
      requireSegment(attachmentId, 'id'),
    );
    await rm(directory, { recursive: true, force: true });
  }

  private requireProject(projectId: string) {
    const project = this.projects.get(projectId.trim());

    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    return project;
  }
}
