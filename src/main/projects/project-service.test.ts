import { describe, expect, it, vi } from 'vitest';

import type { AssetServiceApi } from '../assets/asset-service';
import type { ProjectDatabaseApi } from './project-database';
import { createProjectSnapshot } from './project';
import { ProjectService } from './project-service';

function createDependencies(activeProjectId: string | undefined = undefined) {
  const project = createProjectSnapshot({
    id: 'project',
    name: '学习 Project',
    icon: '📘',
    createdTime: new Date('2026-07-27T01:00:00.000Z'),
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

  return { assetService, calls, projectDatabase };
}

describe('ProjectService', () => {
  it('combines in-memory Projects with persistent Asset counts', () => {
    const { assetService, projectDatabase } = createDependencies();
    const service = new ProjectService(projectDatabase, assetService);

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
    const { assetService, projectDatabase } = createDependencies();
    const service = new ProjectService(projectDatabase, assetService);

    await expect(service.loadProjectWorkspace('project')).resolves.toEqual([]);
    expect(assetService.loadFromProject).toHaveBeenCalledWith('project');
  });

  it('closes only the currently loaded Project', () => {
    const current = createDependencies('project');
    const currentService = new ProjectService(
      current.projectDatabase,
      current.assetService,
    );

    currentService.unloadProjectWorkspace('project');
    expect(current.assetService.unloadProject).toHaveBeenCalledOnce();

    const empty = createDependencies();
    const emptyService = new ProjectService(
      empty.projectDatabase,
      empty.assetService,
    );
    expect(() => emptyService.unloadProjectWorkspace('project')).not.toThrow();

    const other = createDependencies('other');
    const otherService = new ProjectService(
      other.projectDatabase,
      other.assetService,
    );
    expect(() => otherService.unloadProjectWorkspace('project')).toThrow(
      'PROJECT_CONTEXT_CHANGED',
    );
    expect(other.assetService.unloadProject).not.toHaveBeenCalled();
  });

  it('unloads the current Asset Map before deleting its Project', () => {
    const { assetService, calls, projectDatabase } =
      createDependencies('project');
    const service = new ProjectService(projectDatabase, assetService);

    service.deleteProjectCascade('project');

    expect(calls).toEqual(['unload-assets', 'delete-project']);
  });

  it('deletes another Project without unloading the current Asset Map', () => {
    const { assetService, calls, projectDatabase } =
      createDependencies('other');
    const service = new ProjectService(projectDatabase, assetService);

    service.deleteProjectCascade('project');

    expect(calls).toEqual(['delete-project']);
    expect(assetService.unloadProject).not.toHaveBeenCalled();
  });

  it('rejects an unknown Project before changing either container', () => {
    const { assetService, projectDatabase } = createDependencies('project');
    const service = new ProjectService(projectDatabase, assetService);

    expect(() => service.deleteProjectCascade('missing')).toThrow(
      'PROJECT_NOT_FOUND',
    );
    expect(assetService.unloadProject).not.toHaveBeenCalled();
    expect(projectDatabase.delete).not.toHaveBeenCalled();
  });
});
