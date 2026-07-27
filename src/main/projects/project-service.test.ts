import { describe, expect, it, vi } from 'vitest';

import type { AssetServiceApi } from '../assets/asset-service';
import type { WorkbenchSessionLifecycle } from '../workbench/workbench-session-manager';
import type { ProjectDatabaseApi } from './project-database';
import { createProjectSnapshot } from './project';
import { ProjectService } from './project-service';

function createDependencies(activeProjectId: string | undefined = undefined) {
  const project = createProjectSnapshot({
    id: 'project',
    name: '学习 Project',
    icon: '📘',
    createdTime: Date.parse('2026-07-27T01:00:00.000Z'),
  });
  const calls: string[] = [];
  const projectDatabase = {
    list: vi.fn(() => [project]),
    get: vi.fn((id: string) => (id === project.id ? project : undefined)),
    delete: vi.fn(() => calls.push('delete-project')),
  } as unknown as ProjectDatabaseApi;
  const assetService = {
    countByProjectIds: vi.fn(
      (projectIds: readonly string[]) =>
        new Map(projectIds.map((projectId) => [projectId, 3])),
    ),
    loadFromProject: vi.fn(async () => []),
    getActiveProjectId: vi.fn(() => activeProjectId),
    unloadProject: vi.fn(() => calls.push('unload-assets')),
  } as unknown as AssetServiceApi;
  const workbenchSessions = {
    closeActive: vi.fn(async () => {
      calls.push('close-workbench');
    }),
  } as WorkbenchSessionLifecycle;

  return { assetService, calls, projectDatabase, workbenchSessions };
}

describe('ProjectService', () => {
  it('combines in-memory Projects with persistent Asset counts', () => {
    const { assetService, projectDatabase, workbenchSessions } =
      createDependencies();
    const service = new ProjectService(
      projectDatabase,
      assetService,
      workbenchSessions,
    );

    expect(service.listProjectOverviews()).toEqual([
      {
        project: expect.objectContaining({ id: 'project' }),
        assetCount: 3,
      },
    ]);
    expect(service.getProjectOverview('project')).toEqual({
      project: expect.objectContaining({ id: 'project' }),
      assetCount: 3,
    });
    expect(service.getProjectOverview('missing')).toBeUndefined();
    expect(assetService.countByProjectIds).toHaveBeenCalledWith(['project']);
  });

  it('opens a Project through AssetDatabase', async () => {
    const { assetService, projectDatabase, workbenchSessions } =
      createDependencies();
    const service = new ProjectService(
      projectDatabase,
      assetService,
      workbenchSessions,
    );

    await expect(service.loadProjectWorkspace('project')).resolves.toEqual([]);
    expect(workbenchSessions.closeActive).toHaveBeenCalledOnce();
    expect(assetService.loadFromProject).toHaveBeenCalledWith('project');
  });

  it('closes only the currently loaded Project', async () => {
    const current = createDependencies('project');
    const currentService = new ProjectService(
      current.projectDatabase,
      current.assetService,
      current.workbenchSessions,
    );

    await currentService.unloadProjectWorkspace('project');
    expect(current.assetService.unloadProject).toHaveBeenCalledOnce();

    const empty = createDependencies();
    const emptyService = new ProjectService(
      empty.projectDatabase,
      empty.assetService,
      empty.workbenchSessions,
    );
    await expect(
      emptyService.unloadProjectWorkspace('project'),
    ).resolves.toBeUndefined();

    const other = createDependencies('other');
    const otherService = new ProjectService(
      other.projectDatabase,
      other.assetService,
      other.workbenchSessions,
    );
    await expect(otherService.unloadProjectWorkspace('project')).rejects.toThrow(
      'PROJECT_CONTEXT_CHANGED',
    );
    expect(other.assetService.unloadProject).not.toHaveBeenCalled();
  });

  it('unloads the current Asset Map before deleting its Project', async () => {
    const { assetService, calls, projectDatabase, workbenchSessions } =
      createDependencies('project');
    const service = new ProjectService(
      projectDatabase,
      assetService,
      workbenchSessions,
    );

    await service.deleteProjectCascade('project');

    expect(calls).toEqual([
      'close-workbench',
      'unload-assets',
      'delete-project',
    ]);
  });

  it('deletes another Project without unloading the current Asset Map', async () => {
    const { assetService, calls, projectDatabase, workbenchSessions } =
      createDependencies('other');
    const service = new ProjectService(
      projectDatabase,
      assetService,
      workbenchSessions,
    );

    await service.deleteProjectCascade('project');

    expect(calls).toEqual(['delete-project']);
    expect(assetService.unloadProject).not.toHaveBeenCalled();
  });

  it('rejects an unknown Project before changing either container', async () => {
    const { assetService, projectDatabase, workbenchSessions } =
      createDependencies('project');
    const service = new ProjectService(
      projectDatabase,
      assetService,
      workbenchSessions,
    );

    await expect(service.deleteProjectCascade('missing')).rejects.toThrow(
      'PROJECT_NOT_FOUND',
    );
    expect(assetService.unloadProject).not.toHaveBeenCalled();
    expect(projectDatabase.delete).not.toHaveBeenCalled();
  });
});
