import type {
  AssetRuntimeSnapshot,
  AssetServiceApi,
} from '../assets/asset-service';
import { AppError } from '../errors/app-error';
import type { WorkbenchSessionLifecycle } from '../workbench/workbench-session-manager';
import type { ProjectDatabaseApi } from './project-database';
import type { Project } from './project';

export interface ProjectOverview {
  readonly project: Project;
  readonly assetCount: number;
}

export interface ProjectServiceApi {
  listProjectOverviews(): readonly ProjectOverview[];
  getProjectOverview(projectId: string): ProjectOverview | undefined;
  loadProjectWorkspace(
    projectId: string,
  ): Promise<readonly AssetRuntimeSnapshot[]>;
  unloadProjectWorkspace(projectId: string): Promise<void>;
  deleteProjectCascade(projectId: string): Promise<void>;
}

export class ProjectService implements ProjectServiceApi {
  constructor(
    private readonly projectDatabase: ProjectDatabaseApi,
    private readonly assetService: AssetServiceApi,
    private readonly workbenchSessions: WorkbenchSessionLifecycle,
  ) {}

  listProjectOverviews(): readonly ProjectOverview[] {
    const projects = this.projectDatabase.list();
    const counts = this.assetService.countByProjectIds(
      projects.map(({ id }) => id),
    );

    return projects.map((project) => ({
      project,
      assetCount: counts.get(project.id) ?? 0,
    }));
  }

  getProjectOverview(projectId: string): ProjectOverview | undefined {
    const project = this.projectDatabase.get(projectId);

    if (!project) {
      return undefined;
    }

    return {
      project,
      assetCount:
        this.assetService.countByProjectIds([projectId]).get(projectId) ?? 0,
    };
  }

  async loadProjectWorkspace(
    projectId: string,
  ): Promise<readonly AssetRuntimeSnapshot[]> {
    await this.workbenchSessions.closeActive();
    return this.assetService.loadFromProject(projectId);
  }

  async unloadProjectWorkspace(projectId: string): Promise<void> {
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

  async deleteProjectCascade(projectId: string): Promise<void> {
    if (!this.projectDatabase.get(projectId)) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    if (this.assetService.getActiveProjectId() === projectId) {
      await this.workbenchSessions.closeActive();
      this.assetService.unloadProject();
    }

    this.projectDatabase.delete(projectId);
  }
}
