import { describe, expect, it } from 'vitest';

import { Project } from './project';

describe('Project', () => {
  it('creates a serializable summary without sharing the sources array', () => {
    const project = new Project({
      id: 'machine-learning',
      name: '机器学习基础',
      icon: '🤖',
      createdTime: new Date('2026-07-22T08:00:00.000Z'),
      sources: ['source-1'],
    });

    const summary = project.toSummary();
    summary.sources.push('source-2');

    expect(summary.createdTime).toBe('2026-07-22T08:00:00.000Z');
    expect(summary.pinned).toBe(false);
    expect(project.sources).toEqual(['source-1']);
  });

  it('renames and pins a project while preserving clone isolation', () => {
    const project = new Project({
      id: 'machine-learning',
      name: '机器学习基础',
      icon: '🤖',
      createdTime: new Date('2026-07-22T08:00:00.000Z'),
      sources: [],
    });

    project.rename('  机器学习进阶  ');
    project.setPinned(true);
    const clone = project.clone();
    clone.rename('副本');

    expect(project.name).toBe('机器学习进阶');
    expect(project.pinned).toBe(true);
  });

  it('rejects incomplete project data', () => {
    expect(
      () =>
        new Project({
          id: '',
          name: '机器学习基础',
          icon: '🤖',
          createdTime: new Date('2026-07-22T08:00:00.000Z'),
          sources: [],
        }),
    ).toThrow('Project id 不能为空');

    expect(
      () =>
        new Project({
          id: 'machine-learning',
          name: '机器学习基础',
          icon: '🤖',
          createdTime: new Date('invalid'),
          sources: [],
        }),
    ).toThrow('Project createdTime 必须是有效日期');
  });
});
