import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { initializeDatabase } from '../database/initialize-database';
import { GenerationTask } from './generation-task';
import { GenerationTaskDatabase } from './generation-task-database';

const temporaryDirectories: string[] = [];

async function createContext() {
  const directory = await mkdtemp(join(tmpdir(), 'generation-task-db-'));
  temporaryDirectories.push(directory);
  const context = initializeDatabase(join(directory, 'database.sqlite3'));
  context.sqlite
    .prepare(
      `INSERT INTO projects (
        id, name, icon, created_time, pinned, workspace_path
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('project-1', 'Project', '📘', 1, 0, join(directory, 'project'));
  return context;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('GenerationTaskDatabase', () => {
  it('persists and reloads granular checkpoints', async () => {
    const context = await createContext();
    const database = new GenerationTaskDatabase(context);
    const task = GenerationTask.create({
      id: 'task-1',
      projectId: 'project-1',
      definitionId: 'mindmap.generate',
      definitionVersion: 1,
      instruction: { format: 'test', version: 1 },
      assetReferences: { sources: [{ assetId: 'asset-1' }] },
      createdTime: 10,
    });

    try {
      database.create(task.getSnapshot());
      task.recordPrepared({
        checkpoint: {
          completedTime: 20,
          manifestRef: 'control/prepared-manifest.json',
        },
        durationMs: 10,
        updatedTime: 20,
      });
      task.assignProvider('codex', 'codex-account', 21);
      task.recordAgentCallCompleted({
        checkpoint: {
          callKey: 'generate',
          purpose: 'generation',
          completedTime: 30,
          sessionId: 'session-1',
          providerExecutionId: 'turn-2',
        },
        metrics: {
          callKey: 'generate',
          purpose: 'generation',
          sessionId: 'session-1',
          providerId: 'codex',
          connectionId: 'codex-account',
          modelId: 'gpt-5.2',
          startedTime: 21,
          completedTime: 29,
          activeDurationMs: 8,
          turnCount: 1,
          repairTurnCount: 0,
        },
        updatedTime: 30,
      });
      database.update(task.getSnapshot());

      expect(database.get('task-1')).toEqual(task.getSnapshot());
      expect(database.listByProject('project-1')).toEqual([
        task.getSnapshot(),
      ]);
      expect(database.listUnfinishedByProject('project-1')).toEqual([
        task.getSnapshot(),
      ]);
      const unfinishedQueryPlan = context.sqlite
        .prepare<[string], { detail: string }>(
          `EXPLAIN QUERY PLAN
           SELECT *
           FROM generation_tasks
           WHERE project_id = ?
             AND process_completed_time IS NULL
             AND cancelled_time IS NULL
           ORDER BY created_time, id`,
        )
        .all('project-1');
      expect(
        unfinishedQueryPlan.some(({ detail }) =>
          detail.includes(
            'generation_tasks_unfinished_project_created_index',
          ),
        ),
      ).toBe(true);

      task.recordCompleted({
        checkpoint: { completedTime: 35, result: null },
        durationMs: 15,
        updatedTime: 35,
      });
      database.update(task.getSnapshot());
      expect(database.get('task-1')?.completed?.result).toBeNull();
      expect(database.listByProject('project-1')).toHaveLength(1);
      expect(database.listUnfinishedByProject('project-1')).toEqual([]);

      const cancelled = GenerationTask.create({
        id: 'task-2',
        projectId: 'project-1',
        definitionId: 'mindmap.generate',
        definitionVersion: 1,
        instruction: { format: 'test', version: 1 },
        assetReferences: {},
        createdTime: 40,
      });
      database.create(cancelled.getSnapshot());
      cancelled.cancel(45);
      database.update(cancelled.getSnapshot());

      expect(database.listByProject('project-1')).toHaveLength(2);
      expect(database.listUnfinishedByProject('project-1')).toEqual([]);
    } finally {
      context.close();
    }
  });

  it('cascades unfinished tasks when their Project is deleted', async () => {
    const context = await createContext();
    const database = new GenerationTaskDatabase(context);
    const task = GenerationTask.create({
      id: 'task-1',
      projectId: 'project-1',
      definitionId: 'mindmap.generate',
      definitionVersion: 1,
      instruction: { format: 'test', version: 1 },
      assetReferences: {},
      createdTime: 10,
    });

    try {
      database.create(task.getSnapshot());
      context.sqlite
        .prepare('DELETE FROM projects WHERE id = ?')
        .run('project-1');
      expect(database.get('task-1')).toBeUndefined();
    } finally {
      context.close();
    }
  });
});
