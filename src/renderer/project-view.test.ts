import { describe, expect, it } from 'vitest';

import type { ProjectSnapshot } from '../shared/projects';
import {
  filterAndSortProjects,
  formatProjectDate,
  formatAssetCount,
  getProjectCardColor,
} from './project-view';

function createProject(
  id: string,
  name: string,
  createdTime: number,
  pinned = false,
): ProjectSnapshot {
  return {
    id,
    name,
    icon: '📘',
    createdTime,
    assetCount: 0,
    pinned,
  };
}

describe('project view helpers', () => {
  it('formats project metadata in Chinese', () => {
    expect(formatProjectDate(Date.parse('2026-07-22T23:30:00.000Z'))).toBe(
      '2026年7月22日',
    );
    expect(formatAssetCount(12)).toBe('12 个 Asset');
  });

  it('chooses a stable card color from the project id', () => {
    expect(getProjectCardColor('machine-learning')).toBe(
      getProjectCardColor('machine-learning'),
    );
    expect(getProjectCardColor('machine-learning')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('filters project names without changing the input', () => {
    const projects = [
      createProject(
        'a',
        '机器学习基础',
        Date.parse('2026-07-22T00:00:00.000Z'),
      ),
      createProject(
        'b',
        '信号与系统',
        Date.parse('2026-07-21T00:00:00.000Z'),
      ),
    ];

    expect(filterAndSortProjects(projects, '  机器学习 ', 'newest')).toEqual([
      projects[0],
    ]);
    expect(projects.map((project) => project.id)).toEqual(['a', 'b']);
  });

  it('keeps pinned projects first in every sort mode', () => {
    const projects = [
      createProject(
        'newer',
        'C',
        Date.parse('2026-07-22T00:00:00.000Z'),
      ),
      createProject(
        'older',
        'A',
        Date.parse('2026-07-20T00:00:00.000Z'),
      ),
      createProject(
        'pinned',
        'B',
        Date.parse('2026-07-21T00:00:00.000Z'),
        true,
      ),
    ];

    expect(filterAndSortProjects(projects, '', 'newest').map(({ id }) => id)).toEqual([
      'pinned',
      'newer',
      'older',
    ]);
    expect(filterAndSortProjects(projects, '', 'oldest').map(({ id }) => id)).toEqual([
      'pinned',
      'older',
      'newer',
    ]);
    expect(filterAndSortProjects(projects, '', 'title').map(({ id }) => id)).toEqual([
      'pinned',
      'older',
      'newer',
    ]);
  });
});
