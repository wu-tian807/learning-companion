import { describe, expect, it } from 'vitest';

import {
  assetFolderName,
  assetFolderParentPath,
  isAssetFolderPath,
  isAssetFolderPathWithin,
  isAssetFolderState,
  joinAssetFolderPath,
  normalizeAssetFolderName,
  rebaseAssetFolderPath,
} from './asset-folders';

describe('asset folder contracts', () => {
  it('uses canonical Unix-style paths while preserving display casing', () => {
    expect(normalizeAssetFolderName(' 课程 ')).toBe('课程');
    expect(joinAssetFolderPath(null, 'Folder A')).toBe('Folder A');
    expect(joinAssetFolderPath('Folder A', '第二章')).toBe(
      'Folder A/第二章',
    );
    expect(assetFolderName('Folder A/第二章')).toBe('第二章');
    expect(assetFolderParentPath('Folder A/第二章')).toBe('Folder A');
    expect(assetFolderParentPath('Folder A')).toBeNull();
  });

  it.each([
    '',
    '.',
    '..',
    'bad/name',
    'bad\\name',
    'bad:name',
    'bad.',
    'CON',
  ])('rejects a non-portable folder name: %s', (name) => {
    expect(() => normalizeAssetFolderName(name)).toThrow();
  });

  it('matches descendants by complete path segment and rebases casing safely', () => {
    expect(isAssetFolderPathWithin('Course/Part A', 'course')).toBe(true);
    expect(isAssetFolderPathWithin('Coursework', 'Course')).toBe(false);
    expect(rebaseAssetFolderPath('Course/Part A', 'course', 'Archive')).toBe(
      'Archive/Part A',
    );
    expect(rebaseAssetFolderPath('Other', 'Course', 'Archive')).toBe('Other');
  });

  it('validates folder state assignments against declared folders', () => {
    expect(
      isAssetFolderState({
        projectId: 'project',
        folders: [{ projectId: 'project', path: 'Course' }],
        folderPathByAssetId: { asset: 'Course' },
      }),
    ).toBe(true);
    expect(
      isAssetFolderState({
        projectId: 'project',
        folders: [],
        folderPathByAssetId: { asset: 'Missing' },
      }),
    ).toBe(false);
    expect(
      isAssetFolderState({
        projectId: 'project',
        folders: [{ projectId: 'other', path: 'Course' }],
        folderPathByAssetId: {},
      }),
    ).toBe(false);
    expect(
      isAssetFolderState({
        projectId: 'project',
        folders: [
          { projectId: 'project', path: 'Course' },
          { projectId: 'project', path: 'course' },
        ],
        folderPathByAssetId: {},
      }),
    ).toBe(false);
    expect(isAssetFolderPath('Course//Part')).toBe(false);
  });
});
