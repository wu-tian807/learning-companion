import type { AssetSnapshot } from '../../shared/assets';
import {
  cloneProjectSnapshot,
  type Project,
  type ProjectSnapshot,
} from '../../shared/projects';
import type { AssetServiceApi } from '../assets/asset-service';
import { AppError } from '../errors/app-error';
import type { WorkbenchSessionLifecycle } from '../workbench/workbench-session-manager';
import type { CreateProjectInput } from './project';
import type { ProjectDatabaseApi } from './project-database';

export interface ProjectServiceApi {
  listProjects(): readonly ProjectSnapshot[];
  getProject(projectId: string): ProjectSnapshot | undefined;
  createProject(input: CreateProjectInput): ProjectSnapshot;
  renameProject(projectId: string, name: string): ProjectSnapshot;
  setProjectPinned(projectId: string, pinned: boolean): ProjectSnapshot;
  openProject(projectId: string): Promise<readonly AssetSnapshot[]>;
  closeProject(projectId: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}

export class ProjectService implements ProjectServiceApi {
  constructor(
    private readonly projectDatabase: ProjectDatabaseApi,
    private readonly assetService: AssetServiceApi,
    private readonly workbenchSessions: WorkbenchSessionLifecycle,
  ) {}

  listProjects(): readonly ProjectSnapshot[] {
    const projects = this.projectDatabase.list();
    const counts = this.assetService.countByProjectIds(
      projects.map(({ id }) => id),
    );

    return projects.map((project) =>
      cloneProjectSnapshot({
        ...project,
        assetCount: counts.get(project.id) ?? 0,
      }),
    );
  }

  getProject(projectId: string): ProjectSnapshot | undefined {
    const project = this.projectDatabase.get(projectId);

    if (!project) {
      return undefined;
    }

    return cloneProjectSnapshot({
      ...project,
      assetCount:
        this.assetService.countByProjectIds([projectId]).get(projectId) ?? 0,
    });
  }

  createProject(input: CreateProjectInput): ProjectSnapshot {
    const project = this.projectDatabase.add(input);
    return cloneProjectSnapshot({ ...project, assetCount: 0 });
  }

  renameProject(projectId: string, name: string): ProjectSnapshot {
    const project = this.projectDatabase.update(projectId, { name });
    return this.withCurrentAssetCount(project);
  }

  setProjectPinned(projectId: string, pinned: boolean): ProjectSnapshot {
    const project = this.projectDatabase.update(projectId, { pinned });
    return this.withCurrentAssetCount(project);
  }

  async openProject(projectId: string): Promise<readonly AssetSnapshot[]> {
    await this.workbenchSessions.closeActive();
    return this.assetService.loadFromProject(projectId);
  }

  async closeProject(projectId: string): Promise<void> {
    const activeProjectId = this.assetService.getActiveProjectId();

    if (activeProjectId === undefined) {
      await this.workbenchSessions.closeActive();
      return;
    }

    if (activeProjectId !== projectId) {
      throw new AppError('PROJECT_CONTEXT_CHANGED');
    }

    await this.workbenchSessions.closeActive();
    this.assetService.unloadProject();
  }

  async deleteProject(projectId: string): Promise<void> {
    if (!this.projectDatabase.get(projectId)) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    if (this.assetService.getActiveProjectId() === projectId) {
      await this.workbenchSessions.closeActive();
      this.assetService.unloadProject();
    }

    this.projectDatabase.delete(projectId);
  }

  private withCurrentAssetCount(
    project: Project,
  ): ProjectSnapshot {
    return cloneProjectSnapshot({
      ...project,
      assetCount:
        this.assetService.countByProjectIds([project.id]).get(project.id) ?? 0,
    });
  }
}
