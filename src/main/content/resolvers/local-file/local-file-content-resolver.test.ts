import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import iconv from 'iconv-lite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createLocalFileContentInspection,
  type LocalFileContentInspector,
} from './local-file-content-inspector';
import {
  createAbsoluteLocalFileContentRef,
  createProjectWorkspaceContentRef,
} from '../../content-ref';
import type { ProjectWorkspaceManagerApi } from '../../../projects/project-workspace-manager';
import { DefaultTextContentAdapter } from '../../text-content';
import { LocalFileContentResolver } from './local-file-content-resolver';

const temporaryDirectories: string[] = [];
const resolveContext = {
  projectId: 'project',
  projectWorkspace: '/tmp/project',
};
const workspaceManager = {
  resolveLocalFile: async (
    workspacePath: string,
    ref: ReturnType<typeof createAbsoluteLocalFileContentRef>,
  ) =>
    ref.base === 'absolute'
      ? ref.path
      : join(workspacePath, ref.path),
} as ProjectWorkspaceManagerApi;

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
          modifiedTime: Date.parse('2026-07-26T01:00:00.000Z'),
        }),
      ),
    };
    const resolver = new LocalFileContentResolver(
      workspaceManager,
      inspector,
    );

    const resolved = await resolver.resolve(
      createAbsoluteLocalFileContentRef('/tmp/notes.md'),
      resolveContext,
    );

    expect(resolved.contentStatus.availability).toBe('available');
    expect(resolved.observedUpdatedTime).toBe(
      Date.parse('2026-07-26T01:00:00.000Z'),
    );
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
    const resolver = new LocalFileContentResolver(
      workspaceManager,
      inspector,
    );

    const resolved = await resolver.resolve(
      createAbsoluteLocalFileContentRef('/tmp/missing.md'),
      resolveContext,
    );

    expect(resolved.contentStatus.availability).toBe('missing');
    expect(resolved.handle).toBeUndefined();
  });

  it('resolves a Project Workspace reference before inspecting it', async () => {
    const inspect = vi.fn(async (path: string) =>
      createLocalFileContentInspection({
        path,
        availability: 'missing',
        checkedTime: Date.parse('2026-07-27T01:00:00.000Z'),
      }),
    );
    const resolver = new LocalFileContentResolver(workspaceManager, {
      inspect,
    });

    const resolved = await resolver.resolve(
      createProjectWorkspaceContentRef(
        '.learning-companion/assets/imported/content.txt',
      ),
      resolveContext,
    );

    expect(inspect).toHaveBeenCalledWith(
      join(
        resolveContext.projectWorkspace,
        '.learning-companion',
        'assets',
        'imported',
        'content.txt',
      ),
    );
    expect(resolved.contentRef).toEqual({
      kind: 'local-file',
      base: 'project-workspace',
      path: '.learning-companion/assets/imported/content.txt',
    });
  });

  it('exposes generic byte and stream access for available files', async () => {
    const path = await createTemporaryFile(
      'resource.bin',
      Buffer.from('streamed bytes'),
    );
    const resolver = new LocalFileContentResolver(workspaceManager);
    const resolved = await resolver.resolve(
      createAbsoluteLocalFileContentRef(path),
      resolveContext,
    );
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
    const resolver = new LocalFileContentResolver(workspaceManager);
    const resolved = await resolver.resolve(
      createAbsoluteLocalFileContentRef(path),
      resolveContext,
    );
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

  it.runIf(process.platform === 'win32')(
    'restores writability only for an application-managed Asset copy',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'learning-companion-managed-write-'));
      temporaryDirectories.push(root);
      const workspace = join(root, 'workspace');
      const path = join(
        workspace,
        '.learning-companion',
        'assets',
        'imported',
        'lesson.html',
      );
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, '<p>before</p>');
      await chmod(path, 0o400);

      const resolver = new LocalFileContentResolver(workspaceManager);
      const resolved = await resolver.resolve(
        createProjectWorkspaceContentRef(
          '.learning-companion/assets/imported/lesson.html',
        ),
        { projectId: 'project', projectWorkspace: workspace },
      );
      const adapter = new DefaultTextContentAdapter();
      const source = await adapter.read(resolved.handle!);

      await expect(
        adapter.write(resolved.handle!, {
          ...source,
          content: '<p>after</p>',
          expectedRevision: source.revision,
        }),
      ).resolves.toBeDefined();
      await expect(readFile(path, 'utf8')).resolves.toBe('<p>after</p>');
    },
  );

  it.runIf(process.platform === 'win32')(
    'does not remove read-only protection from a linked absolute file',
    async () => {
      const path = await createTemporaryFile(
        'linked.html',
        Buffer.from('<p>before</p>'),
      );
      await chmod(path, 0o400);
      try {
        const resolver = new LocalFileContentResolver(workspaceManager);
        const resolved = await resolver.resolve(
          createAbsoluteLocalFileContentRef(path),
          resolveContext,
        );
        const adapter = new DefaultTextContentAdapter();
        const source = await adapter.read(resolved.handle!);

        await expect(
          adapter.write(resolved.handle!, {
            ...source,
            content: '<p>after</p>',
            expectedRevision: source.revision,
          }),
        ).rejects.toMatchObject({ code: 'CONTENT_WRITE_FAILED' });
        await expect(readFile(path, 'utf8')).resolves.toBe('<p>before</p>');
      } finally {
        await chmod(path, 0o600);
      }
    },
  );

  it.runIf(process.platform === 'win32')(
    'does not trust a managed-looking reference resolved outside its managed directory',
    async () => {
      const path = await createTemporaryFile(
        'escaped.html',
        Buffer.from('<p>before</p>'),
      );
      await chmod(path, 0o400);
      try {
        const resolver = new LocalFileContentResolver({
          resolveLocalFile: async () => path,
        } as never);
        const resolved = await resolver.resolve(
          createProjectWorkspaceContentRef(
            '.learning-companion/assets/imported/escaped.html',
          ),
          resolveContext,
        );
        const adapter = new DefaultTextContentAdapter();
        const source = await adapter.read(resolved.handle!);

        await expect(
          adapter.write(resolved.handle!, {
            ...source,
            content: '<p>after</p>',
            expectedRevision: source.revision,
          }),
        ).rejects.toMatchObject({ code: 'CONTENT_WRITE_FAILED' });
        await expect(readFile(path, 'utf8')).resolves.toBe('<p>before</p>');
      } finally {
        await chmod(path, 0o600);
      }
    },
  );

  it.runIf(process.platform === 'win32')(
    'does not remove read-only protection through a managed-directory junction',
    async () => {
      const root = await mkdtemp(
        join(tmpdir(), 'learning-companion-managed-junction-'),
      );
      temporaryDirectories.push(root);
      const workspace = join(root, 'workspace');
      const externalDirectory = join(root, 'external');
      const managedParent = join(
        workspace,
        '.learning-companion',
        'assets',
      );
      const managedJunction = join(managedParent, 'imported');
      const externalPath = join(externalDirectory, 'lesson.html');
      await mkdir(managedParent, { recursive: true });
      await mkdir(externalDirectory, { recursive: true });
      await writeFile(externalPath, '<p>before</p>');
      await symlink(externalDirectory, managedJunction, 'junction');
      await chmod(externalPath, 0o400);

      try {
        const resolver = new LocalFileContentResolver(workspaceManager);
        const resolved = await resolver.resolve(
          createProjectWorkspaceContentRef(
            '.learning-companion/assets/imported/lesson.html',
          ),
          { projectId: 'project', projectWorkspace: workspace },
        );
        const adapter = new DefaultTextContentAdapter();
        const source = await adapter.read(resolved.handle!);

        await expect(
          adapter.write(resolved.handle!, {
            ...source,
            content: '<p>after</p>',
            expectedRevision: source.revision,
          }),
        ).rejects.toMatchObject({ code: 'CONTENT_WRITE_FAILED' });
        await expect(readFile(externalPath, 'utf8')).resolves.toBe(
          '<p>before</p>',
        );
      } finally {
        await chmod(externalPath, 0o600).catch(() => undefined);
      }
    },
  );

  it('preserves GBK and prevents writing characters it cannot represent', async () => {
    const path = await createTemporaryFile(
      'gbk.txt',
      iconv.encode('中文内容\r\n', 'gbk'),
    );
    const resolver = new LocalFileContentResolver(workspaceManager);
    const resolved = await resolver.resolve(
      createAbsoluteLocalFileContentRef(path),
      resolveContext,
    );
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
    const resolver = new LocalFileContentResolver(workspaceManager);
    const resolved = await resolver.resolve(
      createAbsoluteLocalFileContentRef(path),
      resolveContext,
    );
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
    const resolver = new LocalFileContentResolver(workspaceManager);
    const resolved = await resolver.resolve(
      createAbsoluteLocalFileContentRef(path),
      resolveContext,
    );
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
