import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import iconv from 'iconv-lite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLocalFileContentInspection,
  type LocalFileContentInspector,
} from './local-file-content-inspector';
import {
  createLocalFileContentRef,
  createManagedJsonContentRef,
} from '../../content-ref';
import { LocalFileContentResolver } from './local-file-content-resolver';

const temporaryDirectories: string[] = [];

async function createTemporaryFile(
  name: string,
  content: Uint8Array,
): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-local-content-'),
  );
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, content);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('LocalFileContentResolver', () => {
  it('returns a Handle only for available files', async () => {
    const inspector: LocalFileContentInspector = {
      inspect: vi.fn(async (path) =>
        createLocalFileContentInspection({
          path,
          availability: 'available',
          checkedTime: Date.parse('2026-07-27T01:00:00.000Z'),
        }),
      ),
    };
    const resolver = new LocalFileContentResolver(inspector);

    const resolved = await resolver.resolve(
      createLocalFileContentRef('/tmp/notes.md'),
    );

    expect(resolved.contentStatus.availability).toBe('available');
    expect(resolved.handle).toBeDefined();
    await resolved.handle?.close();
  });

  it('returns status without a Handle for missing files', async () => {
    const inspector: LocalFileContentInspector = {
      inspect: vi.fn(async (path) =>
        createLocalFileContentInspection({
          path,
          availability: 'missing',
          checkedTime: Date.parse('2026-07-27T01:00:00.000Z'),
        }),
      ),
    };
    const resolver = new LocalFileContentResolver(inspector);

    const resolved = await resolver.resolve(
      createLocalFileContentRef('/tmp/missing.md'),
    );

    expect(resolved.contentStatus.availability).toBe('missing');
    expect(resolved.handle).toBeUndefined();
  });

  it('rejects a ref belonging to another Resolver kind', async () => {
    const resolver = new LocalFileContentResolver();

    await expect(
      resolver.resolve(createManagedJsonContentRef('content')),
    ).rejects.toThrow('INVALID_EXTENSION_DEFINITION');
  });

  it('reads and atomically writes UTF-8 text without changing its line endings', async () => {
    const path = await createTemporaryFile(
      'notes.txt',
      Buffer.from('\ufeff第一行\r\n第二行\r\n'),
    );
    const resolver = new LocalFileContentResolver();
    const resolved = await resolver.resolve(createLocalFileContentRef(path));
    const handle = resolved.handle;

    expect(handle?.readText).toBeTypeOf('function');
    expect(handle?.writeText).toBeTypeOf('function');
    const content = await handle!.readText!();
    expect(content).toMatchObject({
      content: '第一行\n第二行\n',
      encoding: 'utf-8',
      lineEnding: 'crlf',
      hasByteOrderMark: true,
    });

    const saved = await handle!.writeText!({
      ...content,
      content: '第一行\n新增内容\n',
      expectedRevision: content.revision,
    });
    const bytes = await readFile(path);

    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(bytes.toString('utf8')).toBe('\ufeff第一行\r\n新增内容\r\n');
    expect(saved.revision).not.toBe(content.revision);
  });

  it('preserves GBK and prevents writing characters it cannot represent', async () => {
    const path = await createTemporaryFile(
      'gbk.txt',
      iconv.encode('中文内容\r\n', 'gbk'),
    );
    const resolver = new LocalFileContentResolver();
    const resolved = await resolver.resolve(createLocalFileContentRef(path));
    const content = await resolved.handle!.readText!();

    expect(content).toMatchObject({
      content: '中文内容\n',
      encoding: 'gbk',
      lineEnding: 'crlf',
    });
    await expect(
      resolved.handle!.writeText!({
        ...content,
        content: '无法保存 emoji 😀',
        expectedRevision: content.revision,
      }),
    ).rejects.toMatchObject({
      code: 'CONTENT_ENCODING_LOSS',
    });
  });

  it('does not overwrite a file changed after the Workbench read it', async () => {
    const path = await createTemporaryFile(
      'external-change.txt',
      Buffer.from('原始内容'),
    );
    const resolver = new LocalFileContentResolver();
    const resolved = await resolver.resolve(createLocalFileContentRef(path));
    const content = await resolved.handle!.readText!();

    await writeFile(path, '外部修改');

    await expect(
      resolved.handle!.writeText!({
        ...content,
        content: '编辑器修改',
        expectedRevision: content.revision,
      }),
    ).rejects.toMatchObject({
      code: 'CONTENT_CHANGED_EXTERNALLY',
    });
    await expect(readFile(path, 'utf8')).resolves.toBe('外部修改');
  });
});
