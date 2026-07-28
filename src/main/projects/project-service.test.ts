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
    add: vi.fn(() => project),
    update: vi.fn(() => project),
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

    expect(service.listProjects()).toEqual([
      expect.objectContaining({ id: 'project', assetCount: 3 }),
    ]);
    expect(service.getProject('project')).toEqual(
      expect.objectContaining({ id: 'project', assetCount: 3 }),
    );
    expect(service.getProject('missing')).toBeUndefined();
    expect(assetService.countByProjectIds).toHaveBeenCalledWith(['project']);
  });

  it('owns Project creation and mutation use cases', () => {
    const { assetService, projectDatabase, workbenchSessions } =
      createDependencies();
    const service = new ProjectService(
      projectDatabase,
      assetService,
      workbenchSessions,
    );

    expect(service.createProject({ name: '新 Project' })).toEqual(
      expect.objectContaining({ id: 'project', assetCount: 0 }),
    );
    service.renameProject('project', '新标题');
    service.setProjectPinned('project', true);

    expect(projectDatabase.add).toHaveBeenCalledWith({ name: '新 Project' });
    expect(projectDatabase.update).toHaveBeenCalledWith('project', {
      name: '新标题',
    });
    expect(projectDatabase.update).toHaveBeenCalledWith('project', {
      pinned: true,
    });
  });

  it('opens a Project through AssetDatabase', async () => {
    const { assetService, projectDatabase, workbenchSessions } =
      createDependencies();
    const service = new ProjectService(
      projectDatabase,
      assetService,
      workbenchSessions,
    );

    await expect(service.openProject('project')).resolves.toEqual([]);
    expect(workbenchSessions.closeActive).toHaveBeenCalledOnce();
    expect(assetService.loadFromProject).toHaveBeenCalledWith('project');
  });

  it('serializes Project close and replacement open lifecycles', async () => {
    const {
      assetService,
      projectDatabase,
      workbenchSessions,
    } = createDependencies('project');
    const service = new ProjectService(
      projectDatabase,
      assetService,
      workbenchSessions,
    );
    let finishClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      finishClose = resolve;
    });

    vi.mocked(workbenchSessions.closeActive)
      .mockImplementationOnce(async () => closeGate)
      .mockResolvedValueOnce(undefined);

    const closing = service.closeProject('project');
    const opening = service.openProject('project');
    await Promise.resolve();
    expect(assetService.loadFromProject).not.toHaveBeenCalled();

    finishClose();
    await closing;
    await opening;
    expect(assetService.unloadProject).toHaveBeenCalledOnce();
    expect(assetService.loadFromProject).toHaveBeenCalledWith('project');
  });

  it('closes only the currently loaded Project', async () => {
    const current = createDependencies('project');
    const currentService = new ProjectService(
      current.projectDatabase,
      current.assetService,
      current.workbenchSessions,
    );

    await currentService.closeProject('project');
    expect(current.assetService.unloadProject).toHaveBeenCalledOnce();

    const empty = createDependencies();
    const emptyService = new ProjectService(
      empty.projectDatabase,
      empty.assetService,
      empty.workbenchSessions,
    );
    await expect(
      emptyService.closeProject('project'),
    ).resolves.toBeUndefined();

    const other = createDependencies('other');
    const otherService = new ProjectService(
      other.projectDatabase,
      other.assetService,
      other.workbenchSessions,
    );
    await expect(otherService.closeProject('project')).rejects.toThrow(
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

    await service.deleteProject('project');

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

    await service.deleteProject('project');

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

    await expect(service.deleteProject('missing')).rejects.toThrow(
      'PROJECT_NOT_FOUND',
    );
    expect(assetService.unloadProject).not.toHaveBeenCalled();
    expect(projectDatabase.delete).not.toHaveBeenCalled();
  });
});
