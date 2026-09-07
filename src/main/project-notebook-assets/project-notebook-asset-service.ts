import type { AssetSnapshot } from '../../shared/assets';
import { randomUUID } from 'node:crypto';
import {
  cloneProjectNotebookSnapshot,
  type ProjectNotebookSnapshot,
} from '../../shared/project-notebook-assets';
import type { AssetServiceApi } from '../assets/asset-service';
import { AppError } from '../errors/app-error';
import type { ProjectLearningNoteServiceApi } from '../project-learning-notes/project-learning-note-service';
import type { ProjectLookup } from '../projects/project-database';
import type { ProjectNotebookAssetDatabaseApi } from './project-notebook-asset-database';

export interface ProjectNotebookAssetServiceApi {
  get(projectId: string): Promise<ProjectNotebookSnapshot>;
  create(projectId: string, name?: string): Promise<AssetSnapshot>;
  select(projectId: string, assetId: string): Promise<ProjectNotebookSnapshot>;
}

/**
 * Coordinates the restricted notebook viewport's selected Markdown Asset.
 * It never writes the legacy note row: that row remains a read-only recovery
 * source until an Asset and its Project relation both exist.
 */
export class ProjectNotebookAssetService
  implements ProjectNotebookAssetServiceApi
{
  private readonly operations = new Map<string, Promise<unknown>>();

  constructor(
    private readonly database: ProjectNotebookAssetDatabaseApi,
    private readonly legacyNotes: ProjectLearningNoteServiceApi,
    private readonly assets: AssetServiceApi,
    private readonly projects: ProjectLookup,
    private readonly now: () => number = Date.now,
  ) {}

  get(projectId: string): Promise<ProjectNotebookSnapshot> {
    return this.serialize(projectId, async () => {
      const normalizedProjectId = this.requireActiveProject(projectId);
      const existing = this.database.get(normalizedProjectId);
      if (existing?.assetId) {
        return cloneProjectNotebookSnapshot(existing);
      }

      if (existing?.migrationOperationId) {
        const asset = this.assets.get(existing.migrationOperationId);
        if (asset?.projectId === normalizedProjectId) {
          return this.persistCreatedAsset(
            normalizedProjectId,
            asset,
            existing.legacyRevision,
          );
        }
        return this.createLegacyAsset(
          normalizedProjectId,
          existing.migrationOperationId,
          existing.legacyRevision,
        );
      }

      // A completed legacy migration remains complete even after the linked
      // Asset is deleted (the FK intentionally turns asset_id into NULL).
      if (existing?.legacyRevision !== undefined) {
        return cloneProjectNotebookSnapshot(existing);
      }

      const legacy = this.legacyNotes.get(normalizedProjectId);
      if (legacy.revision === 0 && legacy.markdown.length === 0) {
        return cloneProjectNotebookSnapshot({ projectId: normalizedProjectId });
      }
      const operationId = randomUUID();
      this.database.save(
        normalizedProjectId,
        undefined,
        legacy.revision,
        operationId,
        this.now(),
      );
      return this.createLegacyAsset(
        normalizedProjectId,
        operationId,
        legacy.revision,
      );
    });
  }

  create(projectId: string, name?: string): Promise<AssetSnapshot> {
    return this.serialize(projectId, async () => {
      const normalizedProjectId = this.requireActiveProject(projectId);
      const asset = await this.assets.createMarkdownNote(
        normalizedProjectId,
        name,
      );
      const current = this.database.get(normalizedProjectId);
      await this.persistCreatedAsset(
        normalizedProjectId,
        asset,
        current?.legacyRevision,
      );
      return asset;
    });
  }

  select(
    projectId: string,
    assetId: string,
  ): Promise<ProjectNotebookSnapshot> {
    return this.serialize(projectId, async () => {
      const normalizedProjectId = this.requireActiveProject(projectId);
      const normalizedAssetId = assetId.trim();
      const asset = this.assets.get(normalizedAssetId);
      if (
        !normalizedAssetId ||
        !asset ||
        asset.projectId !== normalizedProjectId ||
        asset.mediaType !== 'text/markdown'
      ) {
        throw new AppError('ASSET_NOT_FOUND');
      }
      const current = this.database.get(normalizedProjectId);
      return this.database.save(
        normalizedProjectId,
        asset.id,
        current?.legacyRevision,
        undefined,
        this.now(),
      );
    });
  }

  private async persistCreatedAsset(
    projectId: string,
    asset: AssetSnapshot,
    legacyRevision?: number,
  ): Promise<ProjectNotebookSnapshot> {
    try {
      this.requireActiveProject(projectId);
      return this.database.save(
        projectId,
        asset.id,
        legacyRevision,
        undefined,
        this.now(),
      );
    } catch (error) {
      // File and DB cannot share one transaction. Compensate the Asset only
      // when this operation still owns the active Project; if that cleanup
      // itself fails, the managed Asset remains discoverable and retryable.
      if (this.assets.getActiveProjectId() === projectId) {
        await this.assets.delete(asset.id).catch((cleanupError: unknown) => {
          console.error('清理未关联的项目笔记 Asset 失败', cleanupError);
        });
      }
      throw error;
    }
  }

  private async createLegacyAsset(
    projectId: string,
    operationId: string,
    legacyRevision: number | undefined,
  ): Promise<ProjectNotebookSnapshot> {
    if (legacyRevision === undefined) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    const legacy = this.legacyNotes.get(projectId);
    if (legacy.revision !== legacyRevision) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
    const asset = await this.assets.createMarkdownNote(
      projectId,
      '学习笔记',
      legacy.markdown,
      { assetId: operationId },
    );
    return this.persistCreatedAsset(projectId, asset, legacyRevision);
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
