import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createLocalFileContentInspection,
  DefaultLocalFileContentInspector,
} from './local-file-content-inspector';

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

describe('LocalFileContentInspector', () => {
  it('checks readable files, missing paths and directories', async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, 'notes.md');
    const missingPath = join(directory, 'missing.md');
    const nestedDirectory = join(directory, 'folder');
    await writeFile(filePath, '# Notes');
    await mkdir(nestedDirectory);
    const inspector = new DefaultLocalFileContentInspector({
      now: () => Date.parse('2026-07-24T02:00:00.000Z'),
    });

    const available = await inspector.inspect(filePath);

    expect(available).toMatchObject({
      absolutePath: filePath,
      contentStatus: {
        availability: 'available',
        checkedTime: Date.parse('2026-07-24T02:00:00.000Z'),
      },
    });
    expect(available.modifiedTime).toEqual(expect.any(Number));
    await expect(inspector.inspect(missingPath)).resolves.toMatchObject({
      contentStatus: { availability: 'missing' },
    });
    await expect(inspector.inspect(nestedDirectory)).resolves.toMatchObject({
      contentStatus: { availability: 'invalid' },
    });
  });

  it('maps permission errors to inaccessible', async () => {
    const inspector = new DefaultLocalFileContentInspector({
      stat: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
      now: () => Date.parse('2026-07-24T02:00:00.000Z'),
    });

    await expect(
      inspector.inspect('/private/notes.md'),
    ).resolves.toMatchObject({
      contentStatus: { availability: 'inaccessible' },
    });
  });

  it('normalizes paths and returns frozen shared data', () => {
    const inspection = createLocalFileContentInspection({
      path: '/tmp/folder/../notes.md',
      availability: 'available',
      checkedTime: Date.parse('2026-07-24T02:00:00.000Z'),
      modifiedTime: Date.parse('2026-07-24T01:00:00.000Z'),
    });

    expect(inspection.absolutePath).toBe(normalize('/tmp/notes.md'));
    expect(inspection.contentStatus.checkedTime).toBe(
      Date.parse('2026-07-24T02:00:00.000Z'),
    );
    expect(inspection.modifiedTime).toBe(
      Date.parse('2026-07-24T01:00:00.000Z'),
    );
    expect(Object.isFrozen(inspection)).toBe(true);
  });

  it('rejects relative and empty paths, invalid state and invalid time', () => {
    expect(() =>
      createLocalFileContentInspection({
        path: 'notes.md',
        availability: 'available',
        checkedTime: Date.now(),
      }),
    ).toThrow('Asset 本地文件路径必须是绝对路径');
    expect(() =>
      createLocalFileContentInspection({
        path: ' ',
        availability: 'available',
        checkedTime: Date.now(),
      }),
    ).toThrow('Asset 本地文件路径不能为空');
    expect(() =>
      createLocalFileContentInspection({
        path: '/tmp/notes.md',
        availability: 'unsupported' as never,
        checkedTime: Date.now(),
      }),
    ).toThrow('AssetContentStatus 数据无效');
    expect(() =>
      createLocalFileContentInspection({
        path: '/tmp/notes.md',
        availability: 'available',
        checkedTime: Number.NaN,
      }),
    ).toThrow('AssetContentStatus 数据无效');
    expect(() =>
      createLocalFileContentInspection({
        path: '/tmp/notes.md',
        availability: 'available',
        checkedTime: Date.now(),
        modifiedTime: Number.NaN,
      }),
    ).toThrow('Asset 本地文件修改时间无效');
  });
});
