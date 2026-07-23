import { describe, expect, it } from 'vitest';

import { InMemoryProjectRepository } from './in-memory-project-repository';
import { Project } from './project';

function createProject(id: string, createdTime: string): Project {
  return new Project({
    id,
    name: id,
    icon: '📘',
    createdTime: new Date(createdTime),
    sources: [`${id}:source-1`],
  });
}

describe('InMemoryProjectRepository', () => {
  it('returns newest projects first', () => {
    const repository = new InMemoryProjectRepository([
      createProject('older', '2026-07-01T08:00:00.000Z'),
      createProject('newer', '2026-07-22T08:00:00.000Z'),
    ]);

    expect(repository.list().map((project) => project.id)).toEqual(['newer', 'older']);
  });

  it('does not expose its internal projects', () => {
    const repository = new InMemoryProjectRepository([
      createProject('project', '2026-07-22T08:00:00.000Z'),
    ]);

    repository.list()[0]?.sources.push('unexpected-source');

    expect(repository.list()[0]?.sources).toEqual(['project:source-1']);
  });

  it('creates, renames, pins and deletes projects', () => {
    const repository = new InMemoryProjectRepository([], {
      createId: () => 'created-project',
      now: () => new Date('2026-07-23T02:00:00.000Z'),
    });

    const created = repository.create({ name: '新 Project', icon: '📘' });
    const renamed = repository.rename(created.id, '新标题');
    const pinned = repository.setPinned(created.id, true);

    expect(created.toSummary()).toMatchObject({
      id: 'created-project',
      createdTime: '2026-07-23T02:00:00.000Z',
      sources: [],
      pinned: false,
    });
    expect(renamed.name).toBe('新标题');
    expect(pinned.pinned).toBe(true);

    repository.delete(created.id);
    expect(repository.list()).toEqual([]);
  });

  it('rejects operations for an unknown project', () => {
    const repository = new InMemoryProjectRepository([]);

    expect(() => repository.rename('missing', '新标题')).toThrow('找不到指定的 Project');
    expect(() => repository.setPinned('missing', true)).toThrow('找不到指定的 Project');
    expect(() => repository.delete('missing')).toThrow('找不到指定的 Project');
  });
});
