import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { ProjectDatabase } from '../projects/project-database';
import { ProjectLearningNoteDatabase } from './project-learning-note-database';

let context: DatabaseContext;
let directory: string;
let databaseFile: string;
let projects: ProjectDatabase;
let notes: ProjectLearningNoteDatabase;

beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-project-notes-'),
  );
  databaseFile = join(directory, 'data.sqlite3');
  context = initializeDatabase(databaseFile);
  projects = new ProjectDatabase(context);
  projects.initialize();
  projects.add({
    id: 'project-1',
    name: 'Project 1',
    icon: '📘',
    createdTime: 1,
    workspacePath: join(directory, 'project-1'),
  });
  projects.add({
    id: 'project-2',
    name: 'Project 2',
    icon: '📗',
    createdTime: 2,
    workspacePath: join(directory, 'project-2'),
  });
  notes = new ProjectLearningNoteDatabase(context);
});

afterEach(async () => {
  context.close();
  await rm(directory, { recursive: true, force: true });
});

describe('ProjectLearningNoteDatabase', () => {
  it('persists Markdown across restarts and increments a stable revision', () => {
    expect(notes.get('project-1')).toBeUndefined();
    expect(notes.save('project-1', '# 第一版', 0, 10)).toEqual({
      projectId: 'project-1',
      markdown: '# 第一版',
      revision: 1,
      updatedTime: 10,
    });
    expect(notes.save('project-1', '# 第二版', 1, 10)).toEqual({
      projectId: 'project-1',
      markdown: '# 第二版',
      revision: 2,
      updatedTime: 11,
    });

    context.close();
    context = initializeDatabase(databaseFile);
    notes = new ProjectLearningNoteDatabase(context);
    expect(notes.get('project-1')).toEqual({
      projectId: 'project-1',
      markdown: '# 第二版',
      revision: 2,
      updatedTime: 11,
    });
  });

  it('rejects stale saves without overwriting the current Markdown', () => {
    notes.save('project-1', 'current', 0, 10);

    expect(() => notes.save('project-1', 'stale', 0, 11)).toThrow();
    expect(notes.get('project-1')?.markdown).toBe('current');
  });

  it('keeps identically structured notes isolated by Project', () => {
    notes.save('project-1', '# Project 1', 0, 10);
    notes.save('project-2', '# Project 2', 0, 11);

    expect(notes.get('project-1')?.markdown).toBe('# Project 1');
    expect(notes.get('project-2')?.markdown).toBe('# Project 2');
  });

  it('cascades the note when its Project is deleted', () => {
    notes.save('project-1', 'temporary', 0, 10);
    projects.delete('project-1');

    expect(notes.get('project-1')).toBeUndefined();
  });

  it('creates the note table when upgrading an existing version 26 database', () => {
    context.sqlite.exec(`
      DROP TABLE project_learning_notes;
      PRAGMA user_version = 26;
    `);
    context.close();

    context = initializeDatabase(databaseFile);
    notes = new ProjectLearningNoteDatabase(context);
    expect(notes.save('project-1', 'migrated', 0, 12).markdown).toBe(
      'migrated',
    );
  });
});
