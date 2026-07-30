import {
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
        'assets/imported/线性代数.pdf',
        win32,
      ),
    ).toBe('C:\\Learning\\Project\\assets\\imported\\线性代数.pdf');
    expect(() =>
      resolvePortableWorkspacePath(
        'C:\\Learning\\Project',
        '../outside.txt',
        win32,
      ),
    ).toThrow('DATA_INTEGRITY_ERROR');
    expect(toPortableRelativePath('assets\\imported\\a.md')).toBe(
      'assets/imported/a.md',
    );
  });
});

describe('ProjectWorkspaceManager', () => {
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
      createdWorkspaceDirectory: true,
      createdMarker: true,
    });
    for (const directory of [
      join(workspacePath, 'assets', 'imported'),
      join(workspacePath, 'assets', 'generated'),
      join(workspacePath, 'attachments'),
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
    ).toEqual({ schemaVersion: 1, projectId: 'project-a' });

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
    await expect(stat(newWorkspace)).rejects.toMatchObject({
      code: 'ENOENT',
    });

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
      path: 'assets/imported/inside.txt',
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
          path: 'assets/outside-link.txt',
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
      path: 'assets/imported/讲义.md',
    });
    expect(second.contentRef).toEqual({
      kind: 'local-file',
      base: 'project-workspace',
      path: 'assets/imported/讲义 (2).md',
    });
    await expect(
      readFile(first.copiedAbsolutePath!, 'utf8'),
    ).resolves.toBe('# 讲义');
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe('# 讲义');
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
});
