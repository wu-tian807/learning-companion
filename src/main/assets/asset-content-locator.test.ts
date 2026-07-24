import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cloneLocalFileContentLocator,
  createLocalFileContentLocator,
  DefaultLocalFileLocatorChecker,
} from './asset-content-locator';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'learning-companion-locator-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('LocalFileContentLocator', () => {
  it('checks readable files, missing paths and directories', async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, 'notes.md');
    const missingPath = join(directory, 'missing.md');
    const nestedDirectory = join(directory, 'folder');
    await writeFile(filePath, '# Notes');
    await mkdir(nestedDirectory);
    const checker = new DefaultLocalFileLocatorChecker({
      now: () => new Date('2026-07-24T02:00:00.000Z'),
    });

    await expect(checker.check(filePath)).resolves.toEqual({
      kind: 'local-file',
      path: filePath,
      availability: 'available',
      checkedTime: new Date('2026-07-24T02:00:00.000Z'),
    });
    await expect(checker.check(missingPath)).resolves.toMatchObject({
      availability: 'missing',
    });
    await expect(checker.check(nestedDirectory)).resolves.toMatchObject({
      availability: 'invalid',
    });
  });

  it('maps permission errors to inaccessible', async () => {
    const checker = new DefaultLocalFileLocatorChecker({
      stat: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
      now: () => new Date('2026-07-24T02:00:00.000Z'),
    });

    await expect(checker.check('/private/notes.md')).resolves.toMatchObject({
      availability: 'inaccessible',
    });
  });

  it('normalizes paths and isolates checkedTime references', () => {
    const checkedTime = new Date('2026-07-24T02:00:00.000Z');
    const locator = createLocalFileContentLocator({
      path: '/tmp/folder/../notes.md',
      availability: 'available',
      checkedTime,
    });

    checkedTime.setTime(0);
    const clone = cloneLocalFileContentLocator(locator);
    locator.checkedTime.setTime(0);

    expect(clone.path).toBe('/tmp/notes.md');
    expect(clone.checkedTime.toISOString()).toBe('2026-07-24T02:00:00.000Z');
  });

  it('rejects relative and empty paths, invalid state and invalid dates', () => {
    expect(() =>
      createLocalFileContentLocator({
        path: 'notes.md',
        availability: 'available',
        checkedTime: new Date(),
      }),
    ).toThrow('Asset 本地文件路径必须是绝对路径');
    expect(() =>
      createLocalFileContentLocator({
        path: ' ',
        availability: 'available',
        checkedTime: new Date(),
      }),
    ).toThrow('Asset 本地文件路径不能为空');
    expect(() =>
      createLocalFileContentLocator({
        path: '/tmp/notes.md',
        availability: 'unsupported' as never,
        checkedTime: new Date(),
      }),
    ).toThrow('Asset 本地文件可用状态无效');
    expect(() =>
      createLocalFileContentLocator({
        path: '/tmp/notes.md',
        availability: 'available',
        checkedTime: new Date(Number.NaN),
      }),
    ).toThrow('Asset checkedTime 必须是有效日期');
  });
});
