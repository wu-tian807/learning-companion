import { createProjectWorkspaceContentRef } from '../../shared/assets';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ProjectLookup } from '../projects/project-database';
import { AttachmentContentFile } from './attachment-content-file';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe('AttachmentContentFile', () => {
  it('does not follow an owned-looking junction to delete an original', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'lc-attachment-junction-'));
    directories.push(workspacePath);
    const files = new AttachmentContentFile({
      get: (id) => ({ id, name: 'Test', icon: '📘', pinned: false, createdTime: 1, workspacePath }),
    });
    const originalDirectory = join(workspacePath, 'originals');
    await mkdir(originalDirectory);
    await writeFile(join(originalDirectory, 'notes.txt'), 'original');
    await files.write({ projectId: 'project-1', attachmentId: 'attachment-1',
      fileName: 'owned.txt', mediaType: 'text/plain', content: 'owned' });
    const alias = '.learning-companion/attachments/attachment-1/linked';
    await symlink(originalDirectory, join(workspacePath, alias), process.platform === 'win32' ? 'junction' : 'dir');
    await files.removeContent('project-1', 'attachment-1', createProjectWorkspaceContentRef(alias + '/notes.txt'));
    await expect(readFile(join(originalDirectory, 'notes.txt'), 'utf8')).resolves.toBe('original');
  });

  it('atomically writes, reads and removes an Attachment directory', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'lc-attachment-file-'));
    directories.push(workspacePath);
    const projects = {
      get: (projectId: string) =>
        projectId === 'project-1'
          ? {
              id: projectId,
              name: 'Project',
              icon: '📘',
              pinned: false,
              createdTime: 1,
              workspacePath,
            }
          : undefined,
    } as ProjectLookup;
    const files = new AttachmentContentFile(projects);
    const content = await files.write({
      projectId: 'project-1',
      attachmentId: 'attachment-1',
      fileName: 'answer.md',
      mediaType: 'text/markdown',
      content: '# 解释\n',
    });

    expect(content.ref.path).toBe(
      '.learning-companion/attachments/attachment-1/answer.md',
    );
    await expect(files.readText('project-1', content.ref)).resolves.toBe(
      '# 解释\n',
    );
    await files.removeAttachment('project-1', 'attachment-1');
    await expect(
      access(
        join(
          workspacePath,
          '.learning-companion',
          'attachments',
          'attachment-1',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
