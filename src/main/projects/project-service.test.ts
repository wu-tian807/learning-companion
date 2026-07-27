import { describe, expect, it, vi } from 'vitest';

import type { AssetDatabaseApi } from '../assets/asset-database';
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
  const assetDatabase = {
    countByProjectIds: vi.fn(
      (projectIds: readonly string[]) =>
        new Map(projectIds.map((projectId) => [projectId, 3])),
    ),
    loadFromProject: vi.fn(async () => []),
    getActiveProjectId: vi.fn(() => activeProjectId),
    unloadProject: vi.fn(() => calls.push('unload-assets')),
  } as unknown as AssetDatabaseApi;

  return { assetDatabase, calls, projectDatabase };
}

describe('ProjectService', () => {
  it('combines in-memory Projects with persistent Asset counts', () => {
    const { assetDatabase, projectDatabase } = createDependencies();
    const service = new ProjectService(projectDatabase, assetDatabase);

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
    expect(assetDatabase.countByProjectIds).toHaveBeenCalledWith(['project']);
  });

  it('opens a Project through AssetDatabase', async () => {
    const { assetDatabase, projectDatabase } = createDependencies();
    const service = new ProjectService(projectDatabase, assetDatabase);

    await expect(service.loadProjectWorkspace('project')).resolves.toEqual([]);
    expect(assetDatabase.loadFromProject).toHaveBeenCalledWith('project');
  });

  it('closes only the currently loaded Project', () => {
    const current = createDependencies('project');
    const currentService = new ProjectService(
      current.projectDatabase,
      current.assetDatabase,
    );

    currentService.unloadProjectWorkspace('project');
    expect(current.assetDatabase.unloadProject).toHaveBeenCalledOnce();

    const empty = createDependencies();
    const emptyService = new ProjectService(
      empty.projectDatabase,
      empty.assetDatabase,
    );
    expect(() => emptyService.unloadProjectWorkspace('project')).not.toThrow();

    const other = createDependencies('other');
    const otherService = new ProjectService(
      other.projectDatabase,
      other.assetDatabase,
    );
    expect(() => otherService.unloadProjectWorkspace('project')).toThrow(
      '不能卸载非当前 Project',
    );
    expect(other.assetDatabase.unloadProject).not.toHaveBeenCalled();
  });

  it('unloads the current Asset Map before deleting its Project', () => {
    const { assetDatabase, calls, projectDatabase } =
      createDependencies('project');
    const service = new ProjectService(projectDatabase, assetDatabase);

    service.deleteProjectCascade('project');

    expect(calls).toEqual(['unload-assets', 'delete-project']);
  });

  it('deletes another Project without unloading the current Asset Map', () => {
    const { assetDatabase, calls, projectDatabase } =
      createDependencies('other');
    const service = new ProjectService(projectDatabase, assetDatabase);

    service.deleteProjectCascade('project');

    expect(calls).toEqual(['delete-project']);
    expect(assetDatabase.unloadProject).not.toHaveBeenCalled();
  });

  it('rejects an unknown Project before changing either container', () => {
    const { assetDatabase, projectDatabase } = createDependencies('project');
    const service = new ProjectService(projectDatabase, assetDatabase);

    expect(() => service.deleteProjectCascade('missing')).toThrow(
      '找不到指定的 Project',
    );
    expect(assetDatabase.unloadProject).not.toHaveBeenCalled();
    expect(projectDatabase.delete).not.toHaveBeenCalled();
  });
});
