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
import { DefaultTextContentAdapter } from '../../text-content';
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

  it('exposes generic byte and stream access for available files', async () => {
    const path = await createTemporaryFile(
      'resource.bin',
      Buffer.from('streamed bytes'),
    );
    const resolver = new LocalFileContentResolver();
    const resolved = await resolver.resolve(createLocalFileContentRef(path));
    const handle = resolved.handle!;

    await expect(handle.readBytes!()).resolves.toMatchObject({
      content: Buffer.from('streamed bytes'),
    });
    const streamed = await handle.openByteStream!();
    await expect(
      new Response(streamed.stream).text(),
    ).resolves.toBe('streamed bytes');
    expect(streamed.byteLength).toBe(14);
    await expect(handle.getByteLength!()).resolves.toBe(14);

    const range = await handle.openByteStream!({
      start: 3,
      endExclusive: 9,
    });
    await expect(new Response(range.stream).text()).resolves.toBe(
      'eamed ',
    );
    expect(range.byteLength).toBe(6);
    await expect(
      handle.openByteStream!({ start: 10, endExclusive: 20 }),
    ).rejects.toMatchObject({ code: 'INVALID_IPC_REQUEST' });
    await handle.close();
  });

  it('reads and atomically writes UTF-8 text through the text adapter without changing its line endings', async () => {
    const path = await createTemporaryFile(
      'notes.txt',
      Buffer.from('\ufeff第一行\r\n第二行\r\n'),
    );
    const resolver = new LocalFileContentResolver();
    const resolved = await resolver.resolve(createLocalFileContentRef(path));
    const handle = resolved.handle!;
    const adapter = new DefaultTextContentAdapter();

    expect(handle.readBytes).toBeTypeOf('function');
    expect(handle.writeBytes).toBeTypeOf('function');
    const content = await adapter.read(handle);
    expect(content).toMatchObject({
      content: '第一行\n第二行\n',
      encoding: 'utf-8',
      lineEnding: 'crlf',
      hasByteOrderMark: true,
    });

    const saved = await adapter.write(handle, {
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
    const adapter = new DefaultTextContentAdapter();
    const content = await adapter.read(resolved.handle!, {
      encoding: 'gbk',
    });

    expect(content).toMatchObject({
      content: '中文内容\n',
      encoding: 'gbk',
      lineEnding: 'crlf',
    });
    await expect(
      adapter.write(resolved.handle!, {
        ...content,
        content: '无法保存 emoji 😀',
        expectedRevision: content.revision,
      }),
    ).rejects.toMatchObject({
      code: 'CONTENT_ENCODING_LOSS',
    });
  });

  it('rejects bytes that cannot be decoded with the requested encoding', async () => {
    const path = await createTemporaryFile(
      'invalid-utf8.txt',
      Buffer.from([0xff, 0xfe, 0xfd]),
    );
    const resolver = new LocalFileContentResolver();
    const resolved = await resolver.resolve(createLocalFileContentRef(path));
    const adapter = new DefaultTextContentAdapter();

    await expect(
      adapter.read(resolved.handle!, { encoding: 'utf-8' }),
    ).rejects.toMatchObject({
      code: 'CONTENT_ENCODING_UNSUPPORTED',
    });
  });

  it('does not overwrite a file changed after the Workbench read it', async () => {
    const path = await createTemporaryFile(
      'external-change.txt',
      Buffer.from('原始内容'),
    );
    const resolver = new LocalFileContentResolver();
    const resolved = await resolver.resolve(createLocalFileContentRef(path));
    const adapter = new DefaultTextContentAdapter();
    const content = await adapter.read(resolved.handle!);

    await writeFile(path, '外部修改');

    await expect(
      adapter.write(resolved.handle!, {
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
