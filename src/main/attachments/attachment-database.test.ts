import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAbsoluteLocalFileContentRef } from '../../shared/assets';
import { createEpubCfiRangeTarget } from '../../workbenches/epub/shared';
import { AssetDatabase } from '../assets/asset-database';
import { initializeDatabase } from '../database/initialize-database';
import { ProjectDatabase } from '../projects/project-database';
import { AttachmentDatabase } from './attachment-database';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('AttachmentDatabase', () => {
  it('persists, updates, lists, and deletes an EPUB explanation attachment', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-attachment-db-'),
    );
    temporaryDirectories.push(directory);
    const context = initializeDatabase(join(directory, 'data.sqlite3'));

    try {
      const projects = new ProjectDatabase(context);
      projects.initialize();
      projects.add({
        id: 'project-1',
        name: 'Project',
        icon: '📘',
        createdTime: 1,
        pinned: false,
        workspacePath: directory,
      });
      const assets = new AssetDatabase(context, {
        createId: () => 'asset-1',
        now: () => 2,
      });
      assets.add('project-1', {
        name: 'Book',
        mediaType: 'application/epub+zip',
        creationKind: 'imported',
        contentRef: createAbsoluteLocalFileContentRef(
          join(directory, 'book.epub'),
        ),
      });
      const database = new AttachmentDatabase(context);
      const created = database.create({
        id: 'explanation-1',
        projectId: 'project-1',
        assetId: 'asset-1',
        typeId: 'epub.ai-explanation',
        typeVersion: 1,
        target: createEpubCfiRangeTarget({
          cfiRange: 'epubcfi(/6/2!/4/2/1:0,/1:4)',
          quote: { exact: '文字', prefix: '前文', suffix: '后文' },
        }),
        metadata: { status: 'pending' },
        createdTime: 3,
        updatedTime: 3,
      });

      expect(database.listByAsset('asset-1')).toEqual([created]);
      const updated = database.update({
        ...created,
        metadata: { status: 'completed' },
        updatedTime: 4,
      });
      expect(database.get(created.id)).toEqual(updated);

      database.delete(created.id);
      expect(database.get(created.id)).toBeUndefined();
    } finally {
      context.close();
    }
  });
});
