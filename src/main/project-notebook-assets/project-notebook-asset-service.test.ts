import { describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../shared/assets';
import type { ProjectNotebookSnapshot } from '../../shared/project-notebook-assets';
import { ProjectNotebookAssetService } from './project-notebook-asset-service';
import type { ProjectNotebookAssetDatabaseApi } from './project-notebook-asset-database';

function asset(id: string): AssetSnapshot {
  return {
    id,
    projectId: 'project',
    name: '学习笔记',
    mediaType: 'text/markdown',
    creationKind: 'generated',
    contentRef: {
      kind: 'local-file',
      base: 'project-workspace',
      path: `.learning-companion/assets/generated/note-${id}.md`,
    },
    contentStatus: { availability: 'available', checkedTime: 1 },
    createdTime: 1,
    updatedTime: 1,
  };
}

class MemoryDatabase implements ProjectNotebookAssetDatabaseApi {
  record: ProjectNotebookSnapshot | undefined;
  failCompletion = false;

  get(): ProjectNotebookSnapshot | undefined {
    return this.record;
  }

  save(
    projectId: string,
    assetId: string | undefined,
    legacyRevision: number | undefined,
    migrationOperationId: string | undefined,
  ): ProjectNotebookSnapshot {
    if (this.failCompletion && assetId && !migrationOperationId) {
      throw new Error('relation persistence failed');
    }
    this.record = {
      projectId,
      ...(assetId ? { assetId } : {}),
      ...(legacyRevision === undefined ? {} : { legacyRevision }),
      ...(migrationOperationId ? { migrationOperationId } : {}),
    };
    return this.record;
  }
}

function createFixture(database = new MemoryDatabase()) {
  const assets = new Map<string, AssetSnapshot>();
  const createMarkdownNote = vi.fn(
    async (_projectId: string, _name?: string, _body?: string, options?: {
      readonly assetId?: string;
    }) => {
      const id = options?.assetId ?? `manual-${assets.size + 1}`;
      const created = assets.get(id) ?? asset(id);
      assets.set(id, created);
      return created;
    },
  );
  const deleteAsset = vi.fn(async (id: string) => {
    assets.delete(id);
  });
  const assetService = {
    getActiveProjectId: () => 'project',
    get: (id: string) => assets.get(id),
    createMarkdownNote,
    delete: deleteAsset,
  };
  const service = new ProjectNotebookAssetService(
    database,
    {
      get: () => ({ projectId: 'project', markdown: '# legacy\n', revision: 1, updatedTime: 1 }),
      save: vi.fn(),
    },
    assetService as never,
    { get: (id: string) => (id === 'project' ? { id } : undefined) } as never,
    () => 1,
  );
  return { service, database, assets, createMarkdownNote, deleteAsset };
}

describe('ProjectNotebookAssetService', () => {
  it('does not resurrect a migrated legacy body after its selected Asset is deleted', async () => {
    const fixture = createFixture();
    const migrated = await fixture.service.get('project');
    expect(migrated.assetId).toBeDefined();

    fixture.assets.delete(migrated.assetId!);
    fixture.database.record = {
      projectId: 'project',
      legacyRevision: 1,
    };

    await expect(fixture.service.get('project')).resolves.toEqual({
      projectId: 'project',
      legacyRevision: 1,
    });
    expect(fixture.createMarkdownNote).toHaveBeenCalledOnce();

    await fixture.service.create('project');
    expect(fixture.database.record).toMatchObject({ legacyRevision: 1 });
  });

  it('recovers exactly the persisted migration operation after a failed relation cleanup', async () => {
    const fixture = createFixture();
    fixture.database.failCompletion = true;
    fixture.deleteAsset.mockRejectedValueOnce(new Error('delete failed'));

    await expect(fixture.service.get('project')).rejects.toThrow(
      'relation persistence failed',
    );
    expect(fixture.assets.size).toBe(1);
    expect(fixture.database.record?.migrationOperationId).toBeDefined();

    fixture.database.failCompletion = false;
    const restarted = new ProjectNotebookAssetService(
      fixture.database,
      {
        get: () => ({ projectId: 'project', markdown: '# legacy\n', revision: 1, updatedTime: 1 }),
        save: vi.fn(),
      },
      {
        getActiveProjectId: () => 'project',
        get: (id: string) => fixture.assets.get(id),
        createMarkdownNote: fixture.createMarkdownNote,
        delete: fixture.deleteAsset,
      } as never,
      { get: (id: string) => (id === 'project' ? { id } : undefined) } as never,
      () => 2,
    );

    await expect(restarted.get('project')).resolves.toMatchObject({
      assetId: fixture.database.record?.migrationOperationId,
      legacyRevision: 1,
    });
    expect(fixture.assets.size).toBe(1);
    expect(fixture.createMarkdownNote).toHaveBeenCalledOnce();
  });

  it('serializes concurrent first reads into one legacy migration', async () => {
    const fixture = createFixture();
    const [first, second] = await Promise.all([
      fixture.service.get('project'),
      fixture.service.get('project'),
    ]);

    expect(first.assetId).toBe(second.assetId);
    expect(fixture.createMarkdownNote).toHaveBeenCalledOnce();
  });
});
