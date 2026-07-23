import { describe, expect, it } from 'vitest';

import { formatProjectDate, formatSourceCount, getProjectCardColor } from './project-view';

describe('project view helpers', () => {
  it('formats project metadata in Chinese', () => {
    expect(formatProjectDate('2026-07-22T23:30:00.000Z')).toBe('2026年7月22日');
    expect(formatSourceCount(12)).toBe('12 个来源');
  });

  it('chooses a stable card color from the project id', () => {
    expect(getProjectCardColor('machine-learning')).toBe(
      getProjectCardColor('machine-learning'),
    );
    expect(getProjectCardColor('machine-learning')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
