import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, parse, posix, win32 } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isPathInside,
  ProjectWorkspaceManager,
  resolvePortableWorkspacePath,
  toPortableRelativePath,
} from './project-workspace-manager';

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}));

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-workspace-'),
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

describe('ProjectWorkspaceManager path rules', () => {
  it('handles POSIX, Windows drives and UNC shares without host assumptions', () => {
    expect(isPathInside('/project', '/project/assets/a.md', posix)).toBe(
      true,
    );
    expect(isPathInside('/project', '/project-copy/a.md', posix)).toBe(
      false,
    );
    expect(
      isPathInside(
        'C:\\Learning\\Project',
        'c:\\Learning\\Project\\assets\\a.md',
        win32,
      ),
    ).toBe(true);
    expect(
      isPathInside(
        'C:\\Learning\\Project',
        'D:\\Learning\\Project\\assets\\a.md',
        win32,
      ),
    ).toBe(false);
    expect(
      isPathInside(
        '\\\\server\\share\\Project',
        '\\\\server\\share\\Project\\assets\\a.md',
        win32,
      ),
    ).toBe(true);
    expect(
      resolvePortableWorkspacePath(
        'C:\\Learning\\Project',
        '.learning-companion/assets/imported/线性代数.pdf',
        win32,
      ),
    ).toBe(
      'C:\\Learning\\Project\\.learning-companion\\assets\\imported\\线性代数.pdf',
    );
    expect(() =>
      resolvePortableWorkspacePath(
        'C:\\Learning\\Project',
        '../outside.txt',
        win32,
      ),
    ).toThrow('DATA_INTEGRITY_ERROR');
    expect(
      toPortableRelativePath(
        '.learning-companion\\assets\\imported\\a.md',
      ),
    ).toBe('.learning-companion/assets/imported/a.md');
  });
});

describe('ProjectWorkspaceManager', () => {
  it('creates idempotent generated files and removes only managed Asset files', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'project');
    const manager = new ProjectWorkspaceManager();
    await manager.prepareWorkspace({
      projectId: 'project-a',
      workspacePath,
    });

    const created = await manager.createGeneratedFile(
      workspacePath,
      'task-1.mindmap',
      new TextEncoder().encode('first'),
    );
    const existing = await manager.createGeneratedFile(
      workspacePath,
      'task-1.mindmap',
      new TextEncoder().encode('second'),
    );

    expect(created).toMatchObject({
      created: true,
      contentRef: {
        base: 'project-workspace',
        path: '.learning-companion/assets/generated/task-1.mindmap',
      },
    });
    expect(existing).toMatchObject({
      created: false,
      contentRef: created.contentRef,
    });
    expect(await readFile(created.absolutePath, 'utf8')).toBe('first');

    await expect(manager.removeManagedAssetFile(
      workspacePath,
      created.contentRef,
    )).resolves.toBe(true);
    await expect(stat(created.absolutePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const importedPath = join(
      workspacePath,
      '.learning-companion',
      'assets',
      'imported',
      'copied.pdf',
    );
    await writeFile(importedPath, 'copied');
    await expect(
      manager.removeManagedAssetFile(workspacePath, {
        kind: 'local-file',
        base: 'project-workspace',
        path: '.learning-companion/assets/imported/copied.pdf',
      }),
    ).resolves.toBe(true);
    await expect(stat(importedPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      manager.removeManagedAssetFile(workspacePath, {
        kind: 'local-file',
        base: 'project-workspace',
        path: 'notes/source.md',
      }),
    ).resolves.toBe(false);
  });

  it('rejects a filesystem root as a Project Workspace', async () => {
    const manager = new ProjectWorkspaceManager();

    await expect(
      manager.prepareWorkspace({
        projectId: 'project-root',
        workspacePath: parse(await createTemporaryDirectory()).root,
      }),
    ).rejects.toThrow('PROJECT_WORKSPACE_UNAVAILABLE');
  });

  it('prepares the standard directory layout and rejects another Project marker', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'project');
    const manager = new ProjectWorkspaceManager();

    const preparation = await manager.prepareWorkspace({
      projectId: 'project-a',
      workspacePath,
    });

    expect(preparation).toMatchObject({
      workspacePath,
      createdMarker: true,
    });
    for (const directory of [
      join(
        workspacePath,
        '.learning-companion',
        'assets',
        'imported',
      ),
      join(
        workspacePath,
        '.learning-companion',
        'assets',
        'generated',
      ),
      join(workspacePath, '.learning-companion', 'attachments'),
    ]) {
      expect((await stat(directory)).isDirectory()).toBe(true);
    }
    expect(
      JSON.parse(
        await readFile(
          join(
            workspacePath,
            '.learning-companion',
            'workspace.json',
          ),
          'utf8',
        ),
      ),
    ).toEqual({
      schemaVersion: 1,
      projectId: 'project-a',
    });

    await expect(
      manager.prepareWorkspace({
        projectId: 'project-a',
        workspacePath,
      }),
    ).resolves.toMatchObject({ createdMarker: false });
    await expect(
      manager.validateWorkspace({
        projectId: 'project-a',
        workspacePath,
      }),
    ).resolves.toBeUndefined();
    await expect(
      manager.prepareWorkspace({
        projectId: 'project-b',
        workspacePath,
      }),
    ).rejects.toThrow('PROJECT_WORKSPACE_CONFLICT');
    await expect(
      manager.validateWorkspace({
        projectId: 'project-b',
        workspacePath,
      }),
    ).rejects.toThrow('PROJECT_WORKSPACE_CONFLICT');
  });

  it('rolls back only content created for the failed preparation', async () => {
    const root = await createTemporaryDirectory();
    const manager = new ProjectWorkspaceManager();
    const newWorkspace = join(root, 'new-project');
    const created = await manager.prepareWorkspace({
      projectId: 'new-project',
      workspacePath: newWorkspace,
    });

    await manager.rollbackPreparation(created);
    await expect(stat(newWorkspace)).resolves.toBeDefined();
    await expect(
      stat(join(newWorkspace, '.learning-companion')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    const existingWorkspace = join(root, 'existing');
    await mkdir(existingWorkspace);
    await writeFile(join(existingWorkspace, 'user-file.md'), '# 用户资料');
    const existing = await manager.prepareWorkspace({
      projectId: 'existing-project',
      workspacePath: existingWorkspace,
    });

    await manager.rollbackPreparation(existing);
    await expect(
      readFile(join(existingWorkspace, 'user-file.md'), 'utf8'),
    ).resolves.toBe('# 用户资料');
    await expect(
      stat(
        join(
          existingWorkspace,
          '.learning-companion',
          'workspace.json',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('classifies real files and prevents Workspace symlinks from escaping', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'project');
    const outsidePath = join(root, 'outside.txt');
    const manager = new ProjectWorkspaceManager();
    await manager.prepareWorkspace({
      projectId: 'project',
      workspacePath,
    });
    const insidePath = join(
      workspacePath,
      '.learning-companion',
      'assets',
      'imported',
      'inside.txt',
    );
    await writeFile(insidePath, 'inside');
    await writeFile(outsidePath, 'outside');

    await expect(
      manager.classifyLocalFile(workspacePath, insidePath),
    ).resolves.toEqual({
      kind: 'local-file',
      base: 'project-workspace',
      path: '.learning-companion/assets/imported/inside.txt',
    });
    await expect(
      manager.classifyLocalFile(workspacePath, outsidePath),
    ).resolves.toEqual({
      kind: 'local-file',
      base: 'absolute',
      path: outsidePath,
    });

    if (process.platform !== 'win32') {
      const escapingLink = join(
        workspacePath,
        '.learning-companion',
        'assets',
        'outside-link.txt',
      );
      await symlink(outsidePath, escapingLink);
      await expect(
        manager.classifyLocalFile(workspacePath, escapingLink),
      ).resolves.toEqual({
        kind: 'local-file',
        base: 'absolute',
        path: escapingLink,
      });
      await expect(
        manager.resolveLocalFile(workspacePath, {
          kind: 'local-file',
          base: 'project-workspace',
          path: '.learning-companion/assets/outside-link.txt',
        }),
      ).rejects.toThrow('DATA_INTEGRITY_ERROR');
    }
  });

  it('copies external files into imported with deterministic conflict names', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'project');
    const sourcePath = join(root, '讲义.md');
    const manager = new ProjectWorkspaceManager();
    await writeFile(sourcePath, '# 讲义');
    await manager.prepareWorkspace({
      projectId: 'project',
      workspacePath,
    });

    const first = await manager.copyImportedFile(
      workspacePath,
      sourcePath,
    );
    const second = await manager.copyImportedFile(
      workspacePath,
      sourcePath,
    );

    expect(first.contentRef).toEqual({
      kind: 'local-file',
      base: 'project-workspace',
      path: '.learning-companion/assets/imported/讲义.md',
    });
    expect(second.contentRef).toEqual({
      kind: 'local-file',
      base: 'project-workspace',
      path: '.learning-companion/assets/imported/讲义 (2).md',
    });
    await expect(
      readFile(first.copiedAbsolutePath!, 'utf8'),
    ).resolves.toBe('# 讲义');
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe('# 讲义');
  });

  it.each([
    ['application-created', false],
    ['pre-existing', true],
  ])(
    'always preserves the %s Workspace root and deletes only app data',
    async (_label, preExisting) => {
      const root = await createTemporaryDirectory();
      const workspacePath = join(root, 'project');
      if (preExisting) {
        await mkdir(workspacePath);
      }
      const manager = new ProjectWorkspaceManager();
      await manager.prepareWorkspace({
        projectId: 'project',
        workspacePath,
      });
      const userFile = join(workspacePath, 'keep-me.md');
      const externalAsset = join(
        workspacePath,
        'assets',
        'course-notes',
        'keep.md',
      );
      const externalAttachment = join(
        workspacePath,
        'attachments',
        'user-notes',
        'keep.md',
      );
      const appFile = join(
        workspacePath,
        '.learning-companion',
        'checkpoints',
        'video-dubbing',
        'partial.wav',
      );
      await mkdir(join(workspacePath, 'assets', 'course-notes'), {
        recursive: true,
      });
      await mkdir(dirname(externalAttachment), { recursive: true });
      await mkdir(dirname(appFile), { recursive: true });
      await Promise.all([
        writeFile(userFile, 'user content'),
        writeFile(externalAsset, 'external asset'),
        writeFile(externalAttachment, 'external attachment'),
        writeFile(appFile, 'partial'),
      ]);

      await manager.removeProjectWorkspace('project', workspacePath);

      await expect(stat(workspacePath)).resolves.toBeDefined();
      await expect(readFile(userFile, 'utf8')).resolves.toBe('user content');
      await expect(readFile(externalAsset, 'utf8')).resolves.toBe(
        'external asset',
      );
      await expect(readFile(externalAttachment, 'utf8')).resolves.toBe(
        'external attachment',
      );
      await expect(
        stat(join(workspacePath, '.learning-companion')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('keeps the marker until every app-owned child is removed', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'project');
    const metadataPath = join(workspacePath, '.learning-companion');
    const assetsPath = join(metadataPath, 'assets');
    let failAssets = true;
    const remove: typeof rm = async (path, options) => {
      if (failAssets && String(path) === assetsPath) {
        failAssets = false;
        throw Object.assign(new Error('asset directory locked'), {
          code: 'EPERM',
        });
      }
      return options === undefined ? rm(path) : rm(path, options);
    };
    const manager = new ProjectWorkspaceManager({ rm: remove });
    await manager.prepareWorkspace({ projectId: 'project', workspacePath });

    await expect(
      manager.removeProjectWorkspace('project', workspacePath),
    ).rejects.toThrow('asset directory locked');
    await expect(
      stat(join(metadataPath, 'workspace.json')),
    ).resolves.toBeDefined();

    const restartedManager = new ProjectWorkspaceManager();
    await restartedManager.removeProjectWorkspace('project', workspacePath);
    await expect(stat(workspacePath)).resolves.toBeDefined();
    await expect(stat(metadataPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retries an empty metadata directory after final removal fails', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'project');
    const metadataPath = join(workspacePath, '.learning-companion');
    let failMetadata = true;
    const remove: typeof rm = async (path, options) => {
      if (failMetadata && String(path) === metadataPath) {
        failMetadata = false;
        throw Object.assign(new Error('metadata directory locked'), {
          code: 'EPERM',
        });
      }
      return options === undefined ? rm(path) : rm(path, options);
    };
    const manager = new ProjectWorkspaceManager({ rm: remove });
    await manager.prepareWorkspace({ projectId: 'project', workspacePath });

    await expect(
      manager.removeProjectWorkspace('project', workspacePath),
    ).rejects.toThrow('metadata directory locked');
    await expect(readdir(metadataPath)).resolves.toEqual([]);

    const restartedManager = new ProjectWorkspaceManager();
    await restartedManager.removeProjectWorkspace('project', workspacePath);
    await expect(stat(workspacePath)).resolves.toBeDefined();
    await expect(stat(metadataPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes linked children without following them outside app data', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'project');
    const outsidePath = join(root, 'outside');
    const outsideFile = join(outsidePath, 'keep.txt');
    await mkdir(outsidePath);
    await writeFile(outsideFile, 'keep');
    const manager = new ProjectWorkspaceManager();
    await manager.prepareWorkspace({ projectId: 'project', workspacePath });
    await symlink(
      outsidePath,
      join(workspacePath, '.learning-companion', 'linked-child'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await manager.removeProjectWorkspace('project', workspacePath);

    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('keep');
    await expect(stat(workspacePath)).resolves.toBeDefined();
  });

  it('rejects a linked metadata root without touching its target', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'project');
    const metadataPath = join(workspacePath, '.learning-companion');
    const outsidePath = join(root, 'outside');
    const outsideFile = join(outsidePath, 'keep.txt');
    const manager = new ProjectWorkspaceManager();
    await manager.prepareWorkspace({ projectId: 'project', workspacePath });
    await mkdir(outsidePath);
    await writeFile(outsideFile, 'keep');
    await rm(metadataPath, { recursive: true, force: true });
    await symlink(
      outsidePath,
      metadataPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(
      manager.removeProjectWorkspace('project', workspacePath),
    ).rejects.toThrow('PROJECT_WORKSPACE_CONFLICT');
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('keep');
  });

  it('does not claim a pre-existing metadata directory without a marker', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'project');
    const existingFile = join(
      workspacePath,
      '.learning-companion',
      'keep.txt',
    );
    await mkdir(dirname(existingFile), { recursive: true });
    await writeFile(existingFile, 'keep');
    const manager = new ProjectWorkspaceManager();

    await expect(
      manager.prepareWorkspace({ projectId: 'project', workspacePath }),
    ).rejects.toThrow('PROJECT_WORKSPACE_CONFLICT');
    await expect(readFile(existingFile, 'utf8')).resolves.toBe('keep');
  });

  it('keeps the Mind Map extension after resolving an import conflict', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'project');
    const sourcePath = join(root, '课程.mindmap');
    const manager = new ProjectWorkspaceManager();
    await writeFile(sourcePath, '{"format":"learning-companion/mindmap"}');
    await manager.prepareWorkspace({
      projectId: 'project',
      workspacePath,
    });

    await manager.copyImportedFile(workspacePath, sourcePath);
    const second = await manager.copyImportedFile(
      workspacePath,
      sourcePath,
    );

    expect(second.contentRef).toEqual({
      kind: 'local-file',
      base: 'project-workspace',
      path: '.learning-companion/assets/imported/课程 (2).mindmap',
    });
  });

  it('uses explicit Workspace paths for dialogs and shell operations', async () => {
    const projectsPath = join(tmpdir(), 'projects');
    const workspacePath = join(tmpdir(), 'project');
    const selectedWorkspace = join(tmpdir(), 'selected-workspace');
    const selectedFile = join(workspacePath, 'a.md');
    const showOpenDialog = vi
      .fn()
      .mockResolvedValueOnce({
        canceled: false,
        filePaths: [selectedWorkspace],
      })
      .mockResolvedValueOnce({
        canceled: false,
        filePaths: [selectedFile],
      });
    const openPath = vi.fn(async () => '');
    const showItemInFolder = vi.fn();
    const manager = new ProjectWorkspaceManager({
      showOpenDialog,
      openPath,
      showItemInFolder,
    });

    await expect(
      manager.selectWorkspace(projectsPath),
    ).resolves.toBe(selectedWorkspace);
    await expect(
      manager.selectAssetFiles(workspacePath),
    ).resolves.toEqual([selectedFile]);
    await manager.openWorkspace(workspacePath);
    manager.revealFile(selectedFile);

    expect(showOpenDialog).toHaveBeenNthCalledWith(1, {
      defaultPath: projectsPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    expect(showOpenDialog).toHaveBeenNthCalledWith(2, {
      defaultPath: workspacePath,
      properties: ['openFile', 'multiSelections'],
    });
    expect(openPath).toHaveBeenCalledWith(workspacePath);
    expect(showItemInFolder).toHaveBeenCalledWith(selectedFile);
  });

  it('remembers the last successful Asset directory per Workspace in memory', async () => {
    const firstWorkspace = join(tmpdir(), 'first-project');
    const secondWorkspace = join(tmpdir(), 'second-project');
    const selectedDirectory = join(tmpdir(), 'learning-materials');
    const selectedFile = join(selectedDirectory, 'chapter.md');
    const showOpenDialog = vi
      .fn()
      .mockResolvedValueOnce({
        canceled: false,
        filePaths: [selectedFile],
      })
      .mockResolvedValueOnce({
        canceled: true,
        filePaths: [],
      })
      .mockResolvedValueOnce({
        canceled: true,
        filePaths: [],
      });
    const manager = new ProjectWorkspaceManager({
      showOpenDialog,
    });

    await manager.selectAssetFiles(firstWorkspace);
    await manager.selectAssetFiles(firstWorkspace);
    await manager.selectAssetFiles(secondWorkspace);

    expect(showOpenDialog).toHaveBeenNthCalledWith(1, {
      defaultPath: firstWorkspace,
      properties: ['openFile', 'multiSelections'],
    });
    expect(showOpenDialog).toHaveBeenNthCalledWith(2, {
      defaultPath: selectedDirectory,
      properties: ['openFile', 'multiSelections'],
    });
    expect(showOpenDialog).toHaveBeenNthCalledWith(3, {
      defaultPath: secondWorkspace,
      properties: ['openFile', 'multiSelections'],
    });
  });
});
