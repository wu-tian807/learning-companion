import { describe, expect, it, vi } from 'vitest';

import type { AgentSessionProjectLifecycle } from '../agents/sessions/agent-session-service';
import type { AssetServiceApi } from '../assets/asset-service';
import type { AssetAssociationServiceApi } from '../asset-associations/asset-association-service';
import type { SettingsRepository } from '../settings/settings-repository';
import type { WorkbenchSessionLifecycle } from '../workbench/workbench-session-service';
import { createProjectSnapshot } from './project';
import type { ProjectDatabaseApi } from './project-database';
import { ProjectService } from './project-service';
import type { ProjectWorkspaceManagerApi } from './project-workspace-manager';

function createDependencies(activeProjectId: string | undefined = undefined) {
  let project = createProjectSnapshot({
    id: 'project',
    name: '学习 Project',
    icon: '📘',
    createdTime: Date.parse('2026-07-27T01:00:00.000Z'),
    workspacePath: '/tmp/projects/project',
  });
  const calls: string[] = [];
  const projectDatabase = {
    list: vi.fn(() => [project]),
    get: vi.fn((id: string) => (id === project.id ? project : undefined)),
    add: vi.fn((input) => {
      project = createProjectSnapshot(input);
      return project;
    }),
    update: vi.fn((_id, changes) => {
      project = createProjectSnapshot({ ...project, ...changes });
      return project;
    }),
    updateWorkspace: vi.fn((_id, workspacePath) => {
      project = createProjectSnapshot({ ...project, workspacePath });
      return project;
    }),
    delete: vi.fn(() => calls.push('delete-project')),
  } as unknown as ProjectDatabaseApi;
  const assetService = {
    countByProjectIds: vi.fn(
      (projectIds: readonly string[]) =>
        new Map(projectIds.map((projectId) => [projectId, 3])),
    ),
    loadFromProject: vi.fn(async () => {
      calls.push('load-assets');
      return [];
    }),
    getActiveProjectId: vi.fn(() => activeProjectId),
    unloadProject: vi.fn(() => calls.push('unload-assets')),
    cleanupProjectArtifacts: vi.fn(async () => {
      calls.push('cleanup-artifacts');
    }),
  } as unknown as AssetServiceApi;
  const associationService = {
    loadFromProject: vi.fn(() => calls.push('load-associations')),
    unloadProject: vi.fn(() => calls.push('unload-associations')),
    getActiveProjectId: vi.fn(() => activeProjectId),
  } as unknown as AssetAssociationServiceApi;
  const agentSessions = {
    loadFromProject: vi.fn(() => calls.push('load-agent-sessions')),
    unloadProject: vi.fn(() => calls.push('unload-agent-sessions')),
  } as AgentSessionProjectLifecycle;
  const workbenchSessions = {
    closeActive: vi.fn(async () => {
      calls.push('close-workbench');
    }),
  } as WorkbenchSessionLifecycle;
  const workspaceManager = {
    createDefaultWorkspacePath: vi.fn(
      async () => '/tmp/projects/new-project',
    ),
    prepareWorkspace: vi.fn(async ({ workspacePath }) => ({
      workspacePath,
      createdWorkspaceDirectory: true,
      createdMarker: true,
    })),
    rollbackPreparation: vi.fn(async () => undefined),
    selectWorkspace: vi.fn(async () => '/tmp/projects/selected'),
    openWorkspace: vi.fn(async () => undefined),
  } as unknown as ProjectWorkspaceManagerApi;
  const settingsRepository = {
    getDefaultProjectWorkspace: vi.fn(() => '/tmp/projects'),
  } as unknown as SettingsRepository;

  const service = new ProjectService(
    projectDatabase,
    assetService,
    associationService,
    agentSessions,
    workbenchSessions,
    workspaceManager,
    settingsRepository,
    {
      createId: () => 'new-project',
      now: () => Date.parse('2026-07-30T01:00:00.000Z'),
      defaultIcon: () => '🧭',
    },
  );

  return {
    assetService,
    agentSessions,
    associationService,
    calls,
    projectDatabase,
    project: () => project,
    service,
    settingsRepository,
    workbenchSessions,
    workspaceManager,
  };
}

describe('ProjectService', () => {
  it('combines in-memory Projects with persistent Asset counts', () => {
    const { assetService, service } = createDependencies();

    expect(service.listProjects()).toEqual([
      expect.objectContaining({ id: 'project', assetCount: 3 }),
    ]);
    expect(service.getProject('project')).toEqual(
      expect.objectContaining({ id: 'project', assetCount: 3 }),
    );
    expect(service.getProject('missing')).toBeUndefined();
    expect(assetService.countByProjectIds).toHaveBeenCalledWith(['project']);
  });

  it('creates a default Workspace before persisting the Project', async () => {
    const {
      projectDatabase,
      service,
      settingsRepository,
      workspaceManager,
    } = createDependencies();

    await expect(
      service.createProject({ name: '新 Project' }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'new-project',
        assetCount: 0,
        workspacePath: '/tmp/projects/new-project',
      }),
    );
    expect(
      settingsRepository.getDefaultProjectWorkspace,
    ).toHaveBeenCalledOnce();
    expect(workspaceManager.createDefaultWorkspacePath).toHaveBeenCalledWith(
      '/tmp/projects',
      'new-project',
      '新 Project',
    );
    expect(projectDatabase.add).toHaveBeenCalledWith({
      id: 'new-project',
      name: '新 Project',
      icon: '🧭',
      createdTime: Date.parse('2026-07-30T01:00:00.000Z'),
      workspacePath: '/tmp/projects/new-project',
    });
  });

  it('rolls back a newly prepared Workspace when Project persistence fails', async () => {
    const { projectDatabase, service, workspaceManager } =
      createDependencies();
    vi.mocked(projectDatabase.add).mockImplementationOnce(() => {
      throw new Error('database failed');
    });

    await expect(
      service.createProject({ name: '失败 Project' }),
    ).rejects.toThrow('database failed');
    expect(workspaceManager.rollbackPreparation).toHaveBeenCalledOnce();
  });

  it('changes an active Project Workspace through the lifecycle boundary', async () => {
    const {
      assetService,
      calls,
      projectDatabase,
      service,
    } = createDependencies('project');

    await expect(
      service.changeProjectWorkspace(
        'project',
        '/tmp/projects/moved',
      ),
    ).resolves.toEqual(
      expect.objectContaining({ workspacePath: '/tmp/projects/moved' }),
    );
    expect(calls).toEqual([
      'close-workbench',
      'unload-agent-sessions',
      'unload-associations',
      'unload-assets',
      'cleanup-artifacts',
      'load-assets',
      'load-associations',
      'load-agent-sessions',
    ]);
    expect(assetService.cleanupProjectArtifacts).toHaveBeenCalledWith(
      'project',
      '/tmp/projects/project',
    );
    expect(projectDatabase.updateWorkspace).toHaveBeenCalledWith(
      'project',
      '/tmp/projects/moved',
    );
    expect(assetService.loadFromProject).toHaveBeenCalledWith('project');
  });

  it('opens and closes Projects through the serialized lifecycle', async () => {
    const current = createDependencies('project');

    await expect(current.service.openProject('project')).resolves.toEqual([]);
    await current.service.closeProject('project');
    expect(current.assetService.loadFromProject).toHaveBeenCalledWith(
      'project',
    );
    expect(current.assetService.unloadProject).toHaveBeenCalledOnce();
    expect(
      current.associationService.loadFromProject,
    ).toHaveBeenCalledWith('project');
    expect(
      current.associationService.unloadProject,
    ).toHaveBeenCalledOnce();
  });

  it('closes the active Workbench and Asset Map before deleting a Project', async () => {
    const { calls, service } = createDependencies('project');

    await service.deleteProject('project');

    expect(calls).toEqual([
      'close-workbench',
      'unload-agent-sessions',
      'unload-associations',
      'unload-assets',
      'cleanup-artifacts',
      'delete-project',
    ]);
  });

  it('rolls back both Project-scoped services when association loading fails', async () => {
    const current = createDependencies();
    vi.mocked(current.associationService.loadFromProject).mockImplementationOnce(
      () => {
        throw new Error('association load failed');
      },
    );

    await expect(current.service.openProject('project')).rejects.toThrow(
      'association load failed',
    );
    expect(current.calls).toEqual([
      'close-workbench',
      'load-assets',
      'unload-agent-sessions',
      'unload-associations',
      'unload-assets',
    ]);
  });

  it('rejects an unknown Project before changing either container', async () => {
    const { assetService, projectDatabase, service } =
      createDependencies('project');

    await expect(service.deleteProject('missing')).rejects.toThrow(
      'PROJECT_NOT_FOUND',
    );
    expect(assetService.unloadProject).not.toHaveBeenCalled();
    expect(projectDatabase.delete).not.toHaveBeenCalled();
  });
});
