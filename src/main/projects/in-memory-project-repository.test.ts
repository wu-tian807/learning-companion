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
});
