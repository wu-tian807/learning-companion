import { describe, expect, it } from 'vitest';

import { cloneProject, createProjectSnapshot } from './project';

describe('Project', () => {
  it('creates a normalized, frozen data snapshot', () => {
    const project = createProjectSnapshot({
      id: '  machine-learning  ',
      name: '  机器学习基础  ',
      icon: '  🤖  ',
      createdTime: new Date('2026-07-22T08:00:00.000Z'),
    });

    expect(project).toEqual({
      id: 'machine-learning',
      name: '机器学习基础',
      icon: '🤖',
      createdTime: new Date('2026-07-22T08:00:00.000Z'),
      pinned: false,
    });
    expect(Object.isFrozen(project)).toBe(true);
  });

  it('does not share its mutable Date with inputs or clones', () => {
    const inputDate = new Date('2026-07-22T08:00:00.000Z');
    const project = createProjectSnapshot({
      id: 'machine-learning',
      name: '机器学习基础',
      icon: '🤖',
      createdTime: inputDate,
      pinned: true,
    });
    const clone = cloneProject(project);

    inputDate.setTime(0);
    clone.createdTime.setTime(0);

    expect(project.createdTime.toISOString()).toBe('2026-07-22T08:00:00.000Z');
    expect(clone).not.toBe(project);
  });

  it('rejects incomplete or invalid project data', () => {
    expect(() =>
      createProjectSnapshot({
        id: '',
        name: '机器学习基础',
        icon: '🤖',
        createdTime: new Date('2026-07-22T08:00:00.000Z'),
      }),
    ).toThrow('Project id 不能为空');

    expect(() =>
      createProjectSnapshot({
        id: 'machine-learning',
        name: '机器学习基础',
        icon: '🤖',
        createdTime: new Date('invalid'),
      }),
    ).toThrow('Project createdTime 必须是有效日期');

    expect(() =>
      createProjectSnapshot({
        id: 'machine-learning',
        name: '机器学习基础',
        icon: '🤖',
        createdTime: new Date('2026-07-22T08:00:00.000Z'),
        pinned: 'yes' as never,
      }),
    ).toThrow('Project pinned 必须是布尔值');
  });
});
