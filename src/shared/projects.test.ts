import { describe, expect, it } from 'vitest';

import {
  cloneProject,
  cloneProjectSnapshot,
  isProject,
  isProjectSnapshot,
  isProjectSnapshotList,
  isUnixMilliseconds,
} from './projects';

const project = {
  id: 'project',
  name: '机器学习',
  icon: '📘',
  createdTime: 1_753_168_400_000,
  pinned: false,
};

describe('Project shared contract', () => {
  it('validates and clones Project entities', () => {
    expect(isProject(project)).toBe(true);

    const clone = cloneProject(project);

    expect(clone).toEqual(project);
    expect(Object.isFrozen(clone)).toBe(true);
    expect(clone).not.toBe(project);
  });

  it('validates Project snapshots', () => {
    const snapshot = { ...project, assetCount: 3 };

    expect(isProjectSnapshot(snapshot)).toBe(true);
    expect(isProjectSnapshotList([snapshot])).toBe(true);
    expect(cloneProjectSnapshot(snapshot)).toEqual(snapshot);
  });

  it('rejects malformed fields and timestamps', () => {
    expect(isProject({ ...project, name: '' })).toBe(false);
    expect(isProject({ ...project, icon: '' })).toBe(false);
    expect(isProject({ ...project, createdTime: -1 })).toBe(false);
    expect(isProject({ ...project, createdTime: 1.5 })).toBe(false);
    expect(isProjectSnapshot({ ...project, assetCount: -1 })).toBe(false);
    expect(isProjectSnapshotList([{ ...project, assetCount: 0 }, null])).toBe(
      false,
    );
    expect(isUnixMilliseconds(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isUnixMilliseconds(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});
