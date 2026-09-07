import { eq } from 'drizzle-orm';

import {
  cloneProjectNotebookSnapshot,
  type ProjectNotebookSnapshot,
} from '../../shared/project-notebook-assets';
import type { DatabaseContext } from '../database/database-context';
import { projectNotebookAssets } from '../database/schema/project-notebook-assets';

export interface ProjectNotebookAssetDatabaseApi {
  get(projectId: string): ProjectNotebookSnapshot | undefined;
  save(
    projectId: string,
    assetId: string | undefined,
    legacyRevision: number | undefined,
    migrationOperationId: string | undefined,
    updatedTime: number,
  ): ProjectNotebookSnapshot;
}

function fromRow(
  row: typeof projectNotebookAssets.$inferSelect,
): ProjectNotebookSnapshot {
  return cloneProjectNotebookSnapshot({
    projectId: row.projectId,
    ...(row.assetId ? { assetId: row.assetId } : {}),
    ...(row.legacyRevision === null
      ? {}
      : { legacyRevision: row.legacyRevision }),
    ...(row.migrationOperationId
      ? { migrationOperationId: row.migrationOperationId }
      : {}),
  });
}

export class ProjectNotebookAssetDatabase
  implements ProjectNotebookAssetDatabaseApi
{
  constructor(private readonly context: DatabaseContext) {}

  get(projectId: string): ProjectNotebookSnapshot | undefined {
    const row = this.context.db
      .select()
      .from(projectNotebookAssets)
      .where(eq(projectNotebookAssets.projectId, projectId))
      .get();
    return row ? fromRow(row) : undefined;
  }

  save(
    projectId: string,
    assetId: string | undefined,
    legacyRevision: number | undefined,
    migrationOperationId: string | undefined,
    updatedTime: number,
  ): ProjectNotebookSnapshot {
    return this.context.sqlite.transaction(() => {
      const existing = this.context.db
        .select()
        .from(projectNotebookAssets)
        .where(eq(projectNotebookAssets.projectId, projectId))
        .get();
      const next = {
        projectId,
        assetId: assetId ?? null,
        legacyRevision: legacyRevision ?? null,
        migrationOperationId: migrationOperationId ?? null,
        updatedTime: Math.max(updatedTime, (existing?.updatedTime ?? -1) + 1),
      };
      if (existing) {
        this.context.db
          .update(projectNotebookAssets)
          .set(next)
          .where(eq(projectNotebookAssets.projectId, projectId))
          .run();
      } else {
        this.context.db.insert(projectNotebookAssets).values(next).run();
      }
      return fromRow(next);
    })();
  }
}
