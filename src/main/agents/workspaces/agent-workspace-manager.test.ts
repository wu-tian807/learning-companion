import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, posix, win32 } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentWorkspaceManager } from './agent-workspace-manager';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-agent-workspace-'),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe('AgentWorkspaceManager resolve', () => {
  it('resolves POSIX, Windows drive and UNC paths without host assumptions', () => {
    expect(
      new AgentWorkspaceManager('/agent-root', {
        pathRules: posix,
      }).resolve(['questions', 'question-1']),
    ).toBe('/agent-root/questions/question-1');

    expect(
      new AgentWorkspaceManager('C:\\Learning Companion\\Agent', {
        pathRules: win32,
      }).resolve(['generation-center', 'task-1']),
    ).toBe(
      'C:\\Learning Companion\\Agent\\generation-center\\task-1',
    );

    expect(
      new AgentWorkspaceManager('\\\\server\\share\\Agent', {
        pathRules: win32,
      }).resolve(['questions', 'question-1']),
    ).toBe('\\\\server\\share\\Agent\\questions\\question-1');
  });

  const unsafeSegmentSets: readonly (readonly string[])[] = [
    [],
    [''],
    [' task'],
    ['task '],
    ['.'],
    ['..'],
    ['a/b'],
    ['a\\b'],
    ['a\0b'],
    ['a:b'],
    ['task.'],
    ['CON'],
    ['nul.txt'],
    ['COM1'],
    ['lpt9.log'],
  ];

  it.each(unsafeSegmentSets.map((segments) => [segments] as const))(
    'rejects unsafe portable path segments: %j',
    (segments) => {
      const manager = new AgentWorkspaceManager('/agent-root', {
        pathRules: posix,
      });

      expect(() => manager.resolve(segments)).toThrow(
        'DATA_INTEGRITY_ERROR',
      );
    },
  );

  it('rejects relative roots and filesystem roots', () => {
    expect(
      () =>
        new AgentWorkspaceManager('relative/path', {
          pathRules: posix,
        }),
    ).toThrow('DATA_INTEGRITY_ERROR');
    expect(
      () =>
        new AgentWorkspaceManager('/', {
          pathRules: posix,
        }),
    ).toThrow('DATA_INTEGRITY_ERROR');
    expect(
      () =>
        new AgentWorkspaceManager('C:\\', {
          pathRules: win32,
        }),
    ).toThrow('DATA_INTEGRITY_ERROR');
  });
});

describe('AgentWorkspaceManager prepare', () => {
  it('prepares nested directories idempotently', async () => {
    const root = join(await createTemporaryDirectory(), 'agent-root');
    const manager = new AgentWorkspaceManager(root);
    const segments = ['generation-center', 'task-1'];

    const [firstPath, secondPath] = await Promise.all([
      manager.prepare(segments),
      manager.prepare(segments),
    ]);

    expect(firstPath).toBe(join(root, ...segments));
    expect(secondPath).toBe(firstPath);
    expect((await stat(firstPath)).isDirectory()).toBe(true);
  });

  it('uses an immutable snapshot of caller-owned path segments', async () => {
    const root = join(await createTemporaryDirectory(), 'agent-root');
    const manager = new AgentWorkspaceManager(root);
    const segments = ['questions', 'question-1'];
    const preparation = manager.prepare(segments);

    segments[0] = '..';

    await expect(preparation).resolves.toBe(
      join(root, 'questions', 'question-1'),
    );
    await expect(lstat(join(root, 'questions'))).resolves.toBeDefined();
  });

  it('rejects an existing file in the managed path', async () => {
    const root = join(await createTemporaryDirectory(), 'agent-root');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'questions'), 'not a directory');
    const manager = new AgentWorkspaceManager(root);

    await expect(
      manager.prepare(['questions', 'question-1']),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
  });

  it('rejects symlink traversal before creating anything outside the root', async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const root = join(temporaryRoot, 'agent-root');
    const outside = join(temporaryRoot, 'outside');
    const linkedNamespace = join(root, 'questions');
    const outsideQuestion = join(outside, 'question-1');

    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(
      outside,
      linkedNamespace,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const manager = new AgentWorkspaceManager(root);

    await expect(
      manager.prepare(['questions', 'question-1']),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    await expect(lstat(outsideQuestion)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects a configured root that is a symbolic link', async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const actualRoot = join(temporaryRoot, 'actual-root');
    const linkedRoot = join(temporaryRoot, 'linked-root');

    await mkdir(actualRoot, { recursive: true });
    await symlink(
      actualRoot,
      linkedRoot,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const manager = new AgentWorkspaceManager(linkedRoot);

    await expect(manager.prepare(['questions'])).rejects.toThrow(
      'DATA_INTEGRITY_ERROR',
    );
  });

  it('rejects the host filesystem root before touching it', async () => {
    expect(
      () => new AgentWorkspaceManager(parse(tmpdir()).root),
    ).toThrow('DATA_INTEGRITY_ERROR');
  });
});

describe('AgentWorkspaceManager removeProject', () => {
  it('removes one Project tree without touching sibling Projects', async () => {
    const root = join(await createTemporaryDirectory(), 'agent-root');
    const manager = new AgentWorkspaceManager(root);
    const removedFile = join(
      await manager.prepare(['project-a', 'generation-mindmap', 'task-1']),
      'candidate.json',
    );
    const siblingFile = join(
      await manager.prepare(['project-b', 'document-question', 'task-2']),
      'answer.json',
    );
    await writeFile(removedFile, '{}');
    await writeFile(siblingFile, '{}');

    await manager.removeProject('project-a');

    await expect(lstat(join(root, 'project-a'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(lstat(siblingFile)).resolves.toBeDefined();
  });

  it('is idempotent when the Project workspace does not exist', async () => {
    const root = join(await createTemporaryDirectory(), 'agent-root');
    const manager = new AgentWorkspaceManager(root);

    await expect(manager.removeProject('missing-project')).resolves.toBeUndefined();
    await mkdir(root, { recursive: true });
    await expect(manager.removeProject('missing-project')).resolves.toBeUndefined();
  });

  it('rejects a symbolic-link Project workspace without touching its target', async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const root = join(temporaryRoot, 'agent-root');
    const outside = join(temporaryRoot, 'outside');
    const outsideFile = join(outside, 'keep.txt');
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(outsideFile, 'keep');
    await symlink(
      outside,
      join(root, 'linked-project'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const manager = new AgentWorkspaceManager(root);

    await expect(manager.removeProject('linked-project')).rejects.toThrow(
      'DATA_INTEGRITY_ERROR',
    );
    await expect(lstat(outsideFile)).resolves.toBeDefined();
  });

  it('does not follow symbolic links nested inside a removed Project', async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const root = join(temporaryRoot, 'agent-root');
    const outside = join(temporaryRoot, 'outside');
    const outsideFile = join(outside, 'keep.txt');
    const projectPath = await new AgentWorkspaceManager(root).prepare([
      'project-a',
    ]);
    await mkdir(outside, { recursive: true });
    await writeFile(outsideFile, 'keep');
    await symlink(
      outside,
      join(projectPath, 'linked-outside'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const manager = new AgentWorkspaceManager(root);

    await manager.removeProject('project-a');

    await expect(lstat(projectPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('keep');
  });
});
