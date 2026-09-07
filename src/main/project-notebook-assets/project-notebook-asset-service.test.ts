import { describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../shared/assets';
import type { ProjectNotebookSnapshot } from '../../shared/project-notebook-assets';
import { ProjectNotebookAssetService } from './project-notebook-asset-service';
import type { ProjectNotebookAssetDatabaseApi } from './project-notebook-asset-database';

function note(id: string): AssetSnapshot {
  return {
    id, projectId: 'project', name: '学习笔记', mediaType: 'text/markdown',
    creationKind: 'generated',
    contentRef: { kind: 'local-file', base: 'project-workspace', path: `.learning-companion/assets/generated/note-${id}.md` },
    contentStatus: { availability: 'available', checkedTime: 1 },
    createdTime: 1, updatedTime: 1,
  };
}

class MemoryDatabase implements ProjectNotebookAssetDatabaseApi {
  record: ProjectNotebookSnapshot | undefined;
  get(): ProjectNotebookSnapshot | undefined { return this.record; }
  save(projectId: string, assetId: string | undefined): ProjectNotebookSnapshot {
    this.record = { projectId, ...(assetId ? { assetId } : {}) };
    return this.record;
  }
}

function fixture() {
  const database = new MemoryDatabase();
  const assets = new Map<string, AssetSnapshot>();
  const createMarkdownNote = vi.fn(async () => {
    const created = note(`note-${assets.size + 1}`);
    assets.set(created.id, created);
    return created;
  });
  const service = new ProjectNotebookAssetService(
    database,
    {
      getActiveProjectId: () => 'project',
      get: (id: string) => assets.get(id),
      createMarkdownNote,
      delete: vi.fn(async (id: string) => { assets.delete(id); }),
    } as never,
    { get: (id: string) => (id === 'project' ? { id } : undefined) } as never,
    () => 1,
  );
  return { service, database, assets, createMarkdownNote };
}

describe('ProjectNotebookAssetService', () => {
  it('does not read a legacy project_learning_notes body', async () => {
    const { service, createMarkdownNote } = fixture();
    await expect(service.get('project')).resolves.toEqual({ projectId: 'project' });
    expect(createMarkdownNote).not.toHaveBeenCalled();
  });

  it('creates an ordinary Markdown Asset and selects it', async () => {
    const { service, database, createMarkdownNote } = fixture();
    const created = await service.create('project', '我的笔记');
    expect(created.mediaType).toBe('text/markdown');
    expect(createMarkdownNote).toHaveBeenCalledWith('project', '我的笔记');
    expect(database.record).toEqual({ projectId: 'project', assetId: created.id });
  });

  it('only selects Markdown Assets from the active Project', async () => {
    const { service, assets } = fixture();
    assets.set('markdown', note('markdown'));
    await expect(service.select('project', 'markdown')).resolves.toEqual({
      projectId: 'project', assetId: 'markdown',
    });
    await expect(service.select('project', 'missing')).rejects.toMatchObject({
      code: 'ASSET_NOT_FOUND',
    });
  });
});
