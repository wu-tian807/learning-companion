import { randomUUID } from 'node:crypto';

import type { AssetSnapshot } from '../../shared/assets';
import {
  cloneProjectSnapshot,
  type Project,
  type ProjectSnapshot,
} from '../../shared/projects';
import type { AssetServiceApi } from '../assets/asset-service';
import type { AssetAssociationServiceApi } from '../asset-associations/asset-association-service';
import { AppError } from '../errors/app-error';
import type { WorkbenchSessionLifecycle } from '../workbench/workbench-session-service';
import type { SettingsRepository } from '../settings/settings-repository';
import type { CreateProjectInput } from './project';
import type { ProjectDatabaseApi } from './project-database';
import type {
  ProjectWorkspaceManagerApi,
  WorkspacePreparation,
} from './project-workspace-manager';

export interface ProjectServiceApi {
  listProjects(): readonly ProjectSnapshot[];
  getProject(projectId: string): ProjectSnapshot | undefined;
  createProject(input: CreateProjectInput): Promise<ProjectSnapshot>;
  renameProject(projectId: string, name: string): ProjectSnapshot;
  setProjectPinned(projectId: string, pinned: boolean): ProjectSnapshot;
  selectProjectWorkspace(
    projectId?: string,
  ): Promise<string | undefined>;
  changeProjectWorkspace(
    projectId: string,
    workspacePath: string,
  ): Promise<ProjectSnapshot>;
  openProjectWorkspace(projectId: string): Promise<void>;
  openProject(projectId: string): Promise<readonly AssetSnapshot[]>;
  closeProject(projectId: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}

export interface ProjectServiceDependencies {
  readonly createId: () => string;
  readonly now: () => number;
  readonly defaultIcon: () => string;
}

const defaultDependencies: ProjectServiceDependencies = {
  createId: randomUUID,
  now: Date.now,
  defaultIcon: () => '📘',
};

export class ProjectService implements ProjectServiceApi {
  private lifecycleTail: Promise<void> = Promise.resolve();
  private readonly dependencies: ProjectServiceDependencies;

  constructor(
    private readonly projectDatabase: ProjectDatabaseApi,
    private readonly assetService: AssetServiceApi,
    private readonly associationService: AssetAssociationServiceApi,
    private readonly workbenchSessions: WorkbenchSessionLifecycle,
    private readonly workspaceManager: ProjectWorkspaceManagerApi,
    private readonly settingsRepository: SettingsRepository,
    dependencies: Partial<ProjectServiceDependencies> = {},
  ) {
    this.dependencies = {
      ...defaultDependencies,
      ...dependencies,
    };
  }

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

  async createProject(input: CreateProjectInput): Promise<ProjectSnapshot> {
    return this.enqueueLifecycle(async () => {
      const projectId = this.dependencies.createId();
      const workspacePath =
        input.workspacePath ??
        (await this.workspaceManager.createDefaultWorkspacePath(
          this.settingsRepository.getDefaultProjectWorkspace(),
          projectId,
          input.name,
        ));
      const preparation = await this.workspaceManager.prepareWorkspace({
        projectId,
        workspacePath,
      });

      try {
        const project = this.projectDatabase.add({
          id: projectId,
          name: input.name,
          icon: this.dependencies.defaultIcon(),
          createdTime: this.dependencies.now(),
          workspacePath: preparation.workspacePath,
        });

        return cloneProjectSnapshot({ ...project, assetCount: 0 });
      } catch (error) {
        await this.rollbackPreparation(preparation);
        throw error;
      }
    });
  }

  renameProject(projectId: string, name: string): ProjectSnapshot {
    const project = this.projectDatabase.update(projectId, { name });
    return this.withCurrentAssetCount(project);
  }

  setProjectPinned(projectId: string, pinned: boolean): ProjectSnapshot {
    const project = this.projectDatabase.update(projectId, { pinned });
    return this.withCurrentAssetCount(project);
  }

  async selectProjectWorkspace(
    projectId?: string,
  ): Promise<string | undefined> {
    const defaultPath = projectId
      ? this.requireProject(projectId).workspacePath
      : this.settingsRepository.getDefaultProjectWorkspace();

    return this.workspaceManager.selectWorkspace(defaultPath);
  }

  async changeProjectWorkspace(
    projectId: string,
    workspacePath: string,
  ): Promise<ProjectSnapshot> {
    return this.enqueueLifecycle(async () => {
      const currentProject = this.requireProject(projectId);
      const preparation = await this.workspaceManager.prepareWorkspace({
        projectId,
        workspacePath,
      });

      if (preparation.workspacePath === currentProject.workspacePath) {
        return this.withCurrentAssetCount(currentProject);
      }

      const wasActive =
        this.assetService.getActiveProjectId() === projectId;

      if (wasActive) {
        await this.workbenchSessions.closeActive();
        this.unloadProjectRuntime();
      }

      try {
        await this.assetService.cleanupProjectArtifacts(
          projectId,
          currentProject.workspacePath,
        );
        const updated = this.projectDatabase.updateWorkspace(
          projectId,
          preparation.workspacePath,
        );

        if (wasActive) {
          await this.loadProjectRuntime(projectId);
        }

        return this.withCurrentAssetCount(updated);
      } catch (error) {
        await this.restoreProjectWorkspace(
          currentProject,
          preparation,
          wasActive,
        );
        throw error;
      }
    });
  }

  async openProjectWorkspace(projectId: string): Promise<void> {
    await this.workspaceManager.openWorkspace(
      this.requireProject(projectId).workspacePath,
    );
  }

  async openProject(projectId: string): Promise<readonly AssetSnapshot[]> {
    return this.enqueueLifecycle(async () => {
      await this.workbenchSessions.closeActive();
      return this.loadProjectRuntime(projectId);
    });
  }

  async closeProject(projectId: string): Promise<void> {
    await this.enqueueLifecycle(async () => {
      const activeProjectId = this.assetService.getActiveProjectId();

      if (activeProjectId === undefined) {
        await this.workbenchSessions.closeActive();
        this.associationService.unloadProject();
        return;
      }

      if (activeProjectId !== projectId) {
        throw new AppError('PROJECT_CONTEXT_CHANGED');
      }

      await this.workbenchSessions.closeActive();
      this.unloadProjectRuntime();
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.enqueueLifecycle(async () => {
      const project = this.projectDatabase.get(projectId);

      if (!project) {
        throw new AppError('PROJECT_NOT_FOUND');
      }

      if (this.assetService.getActiveProjectId() === projectId) {
        await this.workbenchSessions.closeActive();
        this.unloadProjectRuntime();
      }

      await this.assetService.cleanupProjectArtifacts(
        projectId,
        project.workspacePath,
      );
      this.projectDatabase.delete(projectId);
    });
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

  private requireProject(projectId: string): Project {
    const project = this.projectDatabase.get(projectId);

    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND');
    }

    return project;
  }

  private async rollbackPreparation(
    preparation: WorkspacePreparation,
  ): Promise<void> {
    await this.workspaceManager
      .rollbackPreparation(preparation)
      .catch((rollbackError: unknown) => {
        console.error('回滚 Project Workspace 失败', rollbackError);
      });
  }

  private async restoreProjectWorkspace(
    project: Project,
    preparation: WorkspacePreparation,
    wasActive: boolean,
  ): Promise<void> {
    try {
      const current = this.projectDatabase.get(project.id);

      if (current && current.workspacePath !== project.workspacePath) {
        this.projectDatabase.updateWorkspace(
          project.id,
          project.workspacePath,
        );
      }

      await this.rollbackPreparation(preparation);

      if (wasActive) {
        await this.loadProjectRuntime(project.id);
      }
    } catch (rollbackError) {
      console.error('恢复原 Project Workspace 失败', rollbackError);
    }
  }

  private async loadProjectRuntime(
    projectId: string,
  ): Promise<readonly AssetSnapshot[]> {
    try {
      const assets = await this.assetService.loadFromProject(projectId);
      this.associationService.loadFromProject(projectId);
      return assets;
    } catch (error) {
      this.associationService.unloadProject();
      this.assetService.unloadProject();
      throw error;
    }
  }

  private unloadProjectRuntime(): void {
    this.associationService.unloadProject();
    this.assetService.unloadProject();
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.then(operation);
    this.lifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
