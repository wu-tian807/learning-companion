import type { Asset } from '../assets/asset';
import type { AssetDatabaseApi } from '../assets/asset-database';
import type { ProjectDatabaseApi } from './project-database';

export interface ProjectServiceApi {
  openProject(projectId: string): Promise<readonly Asset[]>;
  closeProject(projectId: string): void;
  deleteProject(projectId: string): void;
}

export class ProjectService implements ProjectServiceApi {
  constructor(
    private readonly projectDatabase: ProjectDatabaseApi,
    private readonly assetDatabase: AssetDatabaseApi,
  ) {}

  openProject(projectId: string): Promise<readonly Asset[]> {
    return this.assetDatabase.loadFromProject(projectId);
  }

  closeProject(projectId: string): void {
    const activeProjectId = this.assetDatabase.getActiveProjectId();

    if (activeProjectId === undefined) {
      return;
    }

    if (activeProjectId !== projectId) {
      throw new Error('不能卸载非当前 Project');
    }

    this.assetDatabase.unloadProject();
  }

  deleteProject(projectId: string): void {
    if (!this.projectDatabase.get(projectId)) {
      throw new Error('找不到指定的 Project');
    }

    if (this.assetDatabase.getActiveProjectId() === projectId) {
      this.assetDatabase.unloadProject();
    }

    this.projectDatabase.delete(projectId);
  }
}
