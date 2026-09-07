import type { AssetSnapshot } from '../../shared/assets';
import {
  cloneProjectNotebookSnapshot,
  type ProjectNotebookSnapshot,
} from '../../shared/project-notebook-assets';
import type { AssetServiceApi } from '../assets/asset-service';
import { AppError } from '../errors/app-error';
import type { ProjectLookup } from '../projects/project-database';
import type { ProjectNotebookAssetDatabaseApi } from './project-notebook-asset-database';

export interface ProjectNotebookAssetServiceApi {
  get(projectId: string): Promise<ProjectNotebookSnapshot>;
  create(projectId: string, name?: string): Promise<AssetSnapshot>;
  select(projectId: string, assetId: string): Promise<ProjectNotebookSnapshot>;
}

/** The notebook is a restricted Markdown Asset viewport, nothing more. */
export class ProjectNotebookAssetService
  implements ProjectNotebookAssetServiceApi
{
  private readonly operations = new Map<string, Promise<unknown>>();

  constructor(
    private readonly database: ProjectNotebookAssetDatabaseApi,
    private readonly assets: AssetServiceApi,
    private readonly projects: ProjectLookup,
    private readonly now: () => number = Date.now,
  ) {}

  get(projectId: string): Promise<ProjectNotebookSnapshot> {
    return this.serialize(projectId, async () => {
      const normalizedProjectId = this.requireActiveProject(projectId);
      return cloneProjectNotebookSnapshot(
        this.database.get(normalizedProjectId) ?? { projectId: normalizedProjectId },
      );
    });
  }

  create(projectId: string, name?: string): Promise<AssetSnapshot> {
    return this.serialize(projectId, async () => {
      const normalizedProjectId = this.requireActiveProject(projectId);
      const asset = await this.assets.createMarkdownNote(normalizedProjectId, name);
      try {
        this.requireActiveProject(normalizedProjectId);
        this.database.save(normalizedProjectId, asset.id, this.now());
        return asset;
      } catch (error) {
        // Managed Asset creation and the relation DB cannot be one transaction.
        if (this.assets.getActiveProjectId() === normalizedProjectId) {
          await this.assets.delete(asset.id).catch(() => undefined);
        }
        throw error;
      }
    });
  }

  select(projectId: string, assetId: string): Promise<ProjectNotebookSnapshot> {
    return this.serialize(projectId, async () => {
      const normalizedProjectId = this.requireActiveProject(projectId);
      const normalizedAssetId = assetId.trim();
      const asset = this.assets.get(normalizedAssetId);
      if (!normalizedAssetId || !asset || asset.projectId !== normalizedProjectId ||
        asset.mediaType !== 'text/markdown') {
        throw new AppError('ASSET_NOT_FOUND');
      }
      return this.database.save(normalizedProjectId, asset.id, this.now());
    });
  }

  private requireActiveProject(projectId: string): string {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId || normalizedProjectId !== projectId) {
      throw new AppError('INVALID_IPC_REQUEST');
    }
    if (!this.projects.get(normalizedProjectId)) {
      throw new AppError('PROJECT_NOT_FOUND');
    }
    if (this.assets.getActiveProjectId() !== normalizedProjectId) {
      throw new AppError('PROJECT_CONTEXT_CHANGED');
    }
    return normalizedProjectId;
  }

  private async serialize<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    const key = projectId.trim();
    const previous = this.operations.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(task);
    this.operations.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.operations.get(key) === operation) this.operations.delete(key);
    }
  }
}
