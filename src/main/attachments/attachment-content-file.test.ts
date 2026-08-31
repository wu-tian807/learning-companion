import { access, mkdtemp, rm } from 'node:fs/promises';
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

    await expect(files.readText('project-1', content.ref)).resolves.toBe(
      '# 解释\n',
    );
    await files.removeAttachment('project-1', 'attachment-1');
    await expect(
      access(join(workspacePath, 'attachments', 'attachment-1')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
