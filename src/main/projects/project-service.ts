import type { Asset } from '../assets/asset';
import type { AssetDatabaseApi } from '../assets/asset-database';
import type { ProjectDatabaseApi } from './project-database';
import type { Project } from './project';

export interface ProjectOverview {
  readonly project: Project;
  readonly assetCount: number;
}

export interface ProjectServiceApi {
  listProjectOverviews(): readonly ProjectOverview[];
  getProjectOverview(projectId: string): ProjectOverview | undefined;
  loadProjectWorkspace(projectId: string): Promise<readonly Asset[]>;
  unloadProjectWorkspace(projectId: string): void;
  deleteProjectCascade(projectId: string): void;
}

export class ProjectService implements ProjectServiceApi {
  constructor(
    private readonly projectDatabase: ProjectDatabaseApi,
    private readonly assetDatabase: AssetDatabaseApi,
  ) {}

  listProjectOverviews(): readonly ProjectOverview[] {
    const projects = this.projectDatabase.list();
    const counts = this.assetDatabase.countByProjectIds(
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
        this.assetDatabase.countByProjectIds([projectId]).get(projectId) ?? 0,
    };
  }

  loadProjectWorkspace(projectId: string): Promise<readonly Asset[]> {
    return this.assetDatabase.loadFromProject(projectId);
  }

  unloadProjectWorkspace(projectId: string): void {
    const activeProjectId = this.assetDatabase.getActiveProjectId();

    if (activeProjectId === undefined) {
      return;
    }

    if (activeProjectId !== projectId) {
      throw new Error('不能卸载非当前 Project');
    }

    this.assetDatabase.unloadProject();
  }

  deleteProjectCascade(projectId: string): void {
    if (!this.projectDatabase.get(projectId)) {
      throw new Error('找不到指定的 Project');
    }

    if (this.assetDatabase.getActiveProjectId() === projectId) {
      this.assetDatabase.unloadProject();
    }

    this.projectDatabase.delete(projectId);
  }
}
