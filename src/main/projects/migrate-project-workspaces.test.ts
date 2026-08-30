import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { migrateProjectWorkspaceDataLayout } from './migrate-project-workspace-data-layout';
import { migrateProjectWorkspaces } from './migrate-project-workspaces';
import { ProjectDatabase } from './project-database';
import { ProjectWorkspaceManager } from './project-workspace-manager';

const contexts: DatabaseContext[] = [];
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-project-migration-'),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    context.close();
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe('migrateProjectWorkspaces', () => {
  it('backfills legacy Project rows before ProjectDatabase initialization', async () => {
    const root = await createTemporaryDirectory();
    const context = initializeDatabase(join(root, 'database.sqlite3'));
    contexts.push(context);
    context.sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, icon, created_time, pinned
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy',
        '旧 Project',
        '📘',
        Date.parse('2026-07-20T01:00:00.000Z'),
        0,
      );
    const defaultWorkspaceRoot = join(root, 'Projects');
    const manager = new ProjectWorkspaceManager();

    await migrateProjectWorkspaces(
      context,
      defaultWorkspaceRoot,
      manager,
    );

    const projectDatabase = new ProjectDatabase(context);
    projectDatabase.initialize();
    const project = projectDatabase.get('legacy')!;

    expect(project.workspacePath).toBe(
      join(defaultWorkspaceRoot, '旧 Project'),
    );
    expect(
      JSON.parse(
        await readFile(
          join(
            project.workspacePath,
            '.learning-companion',
            'workspace.json',
          ),
          'utf8',
        ),
      ),
    ).toEqual({
      schemaVersion: 1,
      projectId: 'legacy',
    });

    await expect(
      migrateProjectWorkspaces(
        context,
        defaultWorkspaceRoot,
        manager,
      ),
    ).resolves.toBeUndefined();
  });

  it('moves legacy managed files once and rewrites their persisted refs', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'workspace');
    const context = initializeDatabase(join(root, 'database.sqlite3'));
    contexts.push(context);
    const manager = new ProjectWorkspaceManager();
    await manager.prepareWorkspace({ projectId: 'project', workspacePath });
    await Promise.all([
      mkdir(join(workspacePath, 'assets', 'imported'), {
        recursive: true,
      }),
      mkdir(join(workspacePath, 'attachments', 'attachment-1'), {
        recursive: true,
      }),
    ]);
    await Promise.all([
      writeFile(
        join(workspacePath, 'assets', 'imported', 'lecture.pdf'),
        'pdf',
      ),
      writeFile(
        join(
          workspacePath,
          'attachments',
          'attachment-1',
          'answer.md',
        ),
        'answer',
      ),
      writeFile(join(workspacePath, 'keep.md'), 'external'),
    ]);
    context.sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, icon, created_time, pinned, workspace_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('project', 'Project', 'book', 1, 0, workspacePath);
    context.sqlite
      .prepare(
        `INSERT INTO assets (
          id, project_id, name, media_type, creation_kind, content_ref,
          created_time, updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'asset',
        'project',
        'Lecture',
        'application/pdf',
        'imported',
        JSON.stringify({
          kind: 'local-file',
          base: 'project-workspace',
          path: 'assets/imported/lecture.pdf',
        }),
        1,
        1,
      );
    context.sqlite
      .prepare(
        `INSERT INTO asset_attachments (
          id, project_id, asset_id, type_id, type_version,
          target_json, metadata_json, content_ref_json,
          content_media_type, created_time, updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'attachment-1',
        'project',
        'asset',
        'test.note',
        1,
        JSON.stringify({ scope: 'asset' }),
        JSON.stringify({}),
        JSON.stringify({
          kind: 'local-file',
          base: 'project-workspace',
          path: 'attachments/attachment-1/answer.md',
        }),
        'text/markdown',
        1,
        1,
      );

    await migrateProjectWorkspaces(context, join(root, 'Projects'), manager);
    await migrateProjectWorkspaces(context, join(root, 'Projects'), manager);

    await expect(
      readFile(
        join(
          workspacePath,
          '.learning-companion',
          'assets',
          'imported',
          'lecture.pdf',
        ),
        'utf8',
      ),
    ).resolves.toBe('pdf');
    await expect(
      readFile(
        join(
          workspacePath,
          '.learning-companion',
          'attachments',
          'attachment-1',
          'answer.md',
        ),
        'utf8',
      ),
    ).resolves.toBe('answer');
    await expect(access(join(workspacePath, 'assets'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      access(join(workspacePath, 'attachments')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(workspacePath, 'keep.md'), 'utf8')).resolves.toBe(
      'external',
    );
    expect(
      JSON.parse(
        context.sqlite
          .prepare<[], { contentRef: string }>(
            'SELECT content_ref AS contentRef FROM assets WHERE id = \'asset\'',
          )
          .get()!.contentRef,
      ),
    ).toMatchObject({
      path: '.learning-companion/assets/imported/lecture.pdf',
    });
    expect(
      JSON.parse(
        context.sqlite
          .prepare<[], { contentRef: string }>(
            `SELECT content_ref_json AS contentRef
             FROM asset_attachments
             WHERE id = 'attachment-1'`,
          )
          .get()!.contentRef,
      ),
    ).toMatchObject({
      path: '.learning-companion/attachments/attachment-1/answer.md',
    });
  });

  it('finishes a ref update after a previous run already moved the file', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'workspace');
    const destinationPath = join(
      workspacePath,
      '.learning-companion',
      'assets',
      'generated',
      'lesson.md',
    );
    const context = initializeDatabase(join(root, 'database.sqlite3'));
    contexts.push(context);
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, 'generated');
    context.sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, icon, created_time, pinned, workspace_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('project', 'Project', 'book', 1, 0, workspacePath);
    context.sqlite
      .prepare(
        `INSERT INTO assets (
          id, project_id, name, media_type, creation_kind, content_ref,
          created_time, updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'asset',
        'project',
        'Lesson',
        'text/markdown',
        'generated',
        JSON.stringify({
          kind: 'local-file',
          base: 'project-workspace',
          path: 'assets/generated/lesson.md',
        }),
        1,
        1,
      );

    await migrateProjectWorkspaceDataLayout(context);

    expect(
      JSON.parse(
        context.sqlite
          .prepare<[], { contentRef: string }>(
            'SELECT content_ref AS contentRef FROM assets WHERE id = \'asset\'',
          )
          .get()!.contentRef,
      ),
    ).toMatchObject({
      path: '.learning-companion/assets/generated/lesson.md',
    });
    await expect(readFile(destinationPath, 'utf8')).resolves.toBe('generated');
  });

  it('does not overwrite a managed destination or rewrite its legacy ref', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'workspace');
    const sourcePath = join(
      workspacePath,
      'assets',
      'generated',
      'lesson.md',
    );
    const destinationPath = join(
      workspacePath,
      '.learning-companion',
      'assets',
      'generated',
      'lesson.md',
    );
    const context = initializeDatabase(join(root, 'database.sqlite3'));
    contexts.push(context);
    await Promise.all([
      mkdir(dirname(sourcePath), { recursive: true }),
      mkdir(dirname(destinationPath), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(sourcePath, 'legacy'),
      writeFile(destinationPath, 'managed'),
    ]);
    const legacyRef = JSON.stringify({
      kind: 'local-file',
      base: 'project-workspace',
      path: 'assets/generated/lesson.md',
    });
    context.sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, icon, created_time, pinned, workspace_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('project', 'Project', 'book', 1, 0, workspacePath);
    context.sqlite
      .prepare(
        `INSERT INTO assets (
          id, project_id, name, media_type, creation_kind, content_ref,
          created_time, updated_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'asset',
        'project',
        'Lesson',
        'text/markdown',
        'generated',
        legacyRef,
        1,
        1,
      );

    await expect(
      migrateProjectWorkspaceDataLayout(context),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');

    await expect(readFile(sourcePath, 'utf8')).resolves.toBe('legacy');
    await expect(readFile(destinationPath, 'utf8')).resolves.toBe('managed');
    expect(
      context.sqlite
        .prepare<[], { contentRef: string }>(
          'SELECT content_ref AS contentRef FROM assets WHERE id = \'asset\'',
        )
        .get()!.contentRef,
    ).toBe(legacyRef);
  });

  it('leaves root-level external directories alone without legacy refs', async () => {
    const root = await createTemporaryDirectory();
    const workspacePath = join(root, 'workspace');
    const assetDirectory = join(workspacePath, 'assets');
    const attachmentDirectory = join(workspacePath, 'attachments');
    const context = initializeDatabase(join(root, 'database.sqlite3'));
    contexts.push(context);
    await Promise.all([
      mkdir(assetDirectory, { recursive: true }),
      mkdir(attachmentDirectory, { recursive: true }),
    ]);
    context.sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, icon, created_time, pinned, workspace_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('project', 'Project', 'book', 1, 0, workspacePath);

    await migrateProjectWorkspaceDataLayout(context);

    await expect(access(assetDirectory)).resolves.toBeUndefined();
    await expect(access(attachmentDirectory)).resolves.toBeUndefined();
  });
});
