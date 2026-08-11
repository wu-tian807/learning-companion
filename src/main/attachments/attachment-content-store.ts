import { readFile } from 'node:fs/promises';

import type { JsonValue } from '../../shared/workbench/protocol';
import type { AssetAttachment } from '../../shared/attachments/contracts';
import type { ProjectLookup } from '../projects/project-database';
import type { ProjectWorkspaceManagerApi } from '../projects/project-workspace-manager';
import { AppError } from '../errors/app-error';

export class AttachmentContentStore {
  constructor(
    private readonly projects: ProjectLookup,
    private readonly workspaces: ProjectWorkspaceManagerApi,
  ) {}

  async write(projectId: string, attachmentId: string, body: JsonValue) {
    const project = this.projects.get(projectId);
    if (!project) throw new AppError('PROJECT_NOT_FOUND');
    const generated = await this.workspaces.createGeneratedFile(
      project.workspacePath,
      `attachment-${attachmentId}.json`,
      Buffer.from(`${JSON.stringify(body, null, 2)}\n`, 'utf8'),
    );
    if (generated.contentRef.base !== 'project-workspace') {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    return {
      ref: generated.contentRef,
      mediaType: 'application/json',
    } satisfies NonNullable<AssetAttachment['content']>;
  }

  async read(projectId: string, content: NonNullable<AssetAttachment['content']>): Promise<JsonValue> {
    const project = this.projects.get(projectId);
    if (!project) throw new AppError('PROJECT_NOT_FOUND');
    const path = await this.workspaces.resolveLocalFile(project.workspacePath, content.ref);
    return JSON.parse(await readFile(path, 'utf8')) as JsonValue;
  }

  async remove(projectId: string, content: NonNullable<AssetAttachment['content']>): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;
    await this.workspaces.removeManagedAssetFile(project.workspacePath, content.ref);
  }
}
