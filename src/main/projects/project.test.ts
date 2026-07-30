import { describe, expect, it } from 'vitest';

import { cloneProject, createProjectSnapshot } from './project';

describe('Project', () => {
  it('creates a normalized, frozen data snapshot', () => {
    const project = createProjectSnapshot({
      id: '  machine-learning  ',
      name: '  机器学习基础  ',
      icon: '  🤖  ',
      createdTime: Date.parse('2026-07-22T08:00:00.000Z'),
      workspacePath: '  /tmp/projects/machine-learning  ',
    });

    expect(project).toEqual({
      id: 'machine-learning',
      name: '机器学习基础',
      icon: '🤖',
      createdTime: Date.parse('2026-07-22T08:00:00.000Z'),
      pinned: false,
      workspacePath: '/tmp/projects/machine-learning',
    });
    expect(Object.isFrozen(project)).toBe(true);
  });

  it('clones immutable primitive data without sharing the object', () => {
    const project = createProjectSnapshot({
      id: 'machine-learning',
      name: '机器学习基础',
      icon: '🤖',
      createdTime: Date.parse('2026-07-22T08:00:00.000Z'),
      pinned: true,
      workspacePath: '/tmp/projects/machine-learning',
    });
    const clone = cloneProject(project);

    expect(project.createdTime).toBe(Date.parse('2026-07-22T08:00:00.000Z'));
    expect(clone).not.toBe(project);
  });

  it('rejects incomplete or invalid project data', () => {
    expect(() =>
      createProjectSnapshot({
        id: '',
        name: '机器学习基础',
        icon: '🤖',
        createdTime: Date.parse('2026-07-22T08:00:00.000Z'),
        workspacePath: '/tmp/projects/machine-learning',
      }),
    ).toThrow('Project 数据无效');

    expect(() =>
      createProjectSnapshot({
        id: 'machine-learning',
        name: '机器学习基础',
        icon: '🤖',
        createdTime: Number.NaN,
        workspacePath: '/tmp/projects/machine-learning',
      }),
    ).toThrow('Project 数据无效');

    expect(() =>
      createProjectSnapshot({
        id: 'machine-learning',
        name: '机器学习基础',
        icon: '🤖',
        createdTime: Date.parse('2026-07-22T08:00:00.000Z'),
        pinned: 'yes' as never,
        workspacePath: '/tmp/projects/machine-learning',
      }),
    ).toThrow('Project 数据无效');

    expect(() =>
      createProjectSnapshot({
        id: 'machine-learning',
        name: '机器学习基础',
        icon: '🤖',
        createdTime: Date.parse('2026-07-22T08:00:00.000Z'),
        workspacePath: 'relative/project',
      }),
    ).toThrow('Project 数据无效');
  });
});
