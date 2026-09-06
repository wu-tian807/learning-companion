import { and, eq } from 'drizzle-orm';

import {
  cloneProjectLearningNote,
  type ProjectLearningNoteSnapshot,
} from '../../shared/project-learning-notes';
import type { DatabaseContext } from '../database/database-context';
import { projectLearningNotes } from '../database/schema/project-learning-notes';
import { AppError } from '../errors/app-error';

export interface ProjectLearningNoteDatabaseApi {
  get(projectId: string): ProjectLearningNoteSnapshot | undefined;
  save(
    projectId: string,
    markdown: string,
    expectedRevision: number,
    updatedTime: number,
  ): ProjectLearningNoteSnapshot;
}

function fromRow(
  row: typeof projectLearningNotes.$inferSelect,
): ProjectLearningNoteSnapshot {
  return cloneProjectLearningNote({
    projectId: row.projectId,
    markdown: row.markdown,
    revision: row.revision,
    updatedTime: row.updatedTime,
  });
}

export class ProjectLearningNoteDatabase
  implements ProjectLearningNoteDatabaseApi
{
  constructor(private readonly context: DatabaseContext) {}

  get(projectId: string): ProjectLearningNoteSnapshot | undefined {
    const row = this.context.db
      .select()
      .from(projectLearningNotes)
      .where(eq(projectLearningNotes.projectId, projectId))
      .get();
    return row ? fromRow(row) : undefined;
  }

  save(
    projectId: string,
    markdown: string,
    expectedRevision: number,
    updatedTime: number,
  ): ProjectLearningNoteSnapshot {
    return this.context.sqlite.transaction(() => {
      const existing = this.context.db
        .select()
        .from(projectLearningNotes)
        .where(eq(projectLearningNotes.projectId, projectId))
        .get();

      if (!existing) {
        if (expectedRevision !== 0) {
          throw new AppError('DATABASE_WRITE_CONFLICT');
        }

        const next = {
          projectId,
          markdown,
          revision: 1,
          updatedTime,
        };
        const result = this.context.db
          .insert(projectLearningNotes)
          .values(next)
          .run();
        if (result.changes !== 1) {
          throw new AppError('DATABASE_WRITE_CONFLICT');
        }
        return fromRow(next);
      }

      if (existing.revision !== expectedRevision) {
        throw new AppError('DATABASE_WRITE_CONFLICT');
      }

      const nextRevision = existing.revision + 1;
      const nextUpdatedTime = Math.max(updatedTime, existing.updatedTime + 1);
      const result = this.context.db
        .update(projectLearningNotes)
        .set({
          markdown,
          revision: nextRevision,
          updatedTime: nextUpdatedTime,
        })
        .where(
          and(
            eq(projectLearningNotes.projectId, projectId),
            eq(projectLearningNotes.revision, expectedRevision),
          ),
        )
        .run();
      if (result.changes !== 1) {
        throw new AppError('DATABASE_WRITE_CONFLICT');
      }
      return fromRow({
        projectId,
        markdown,
        revision: nextRevision,
        updatedTime: nextUpdatedTime,
      });
    })();
  }
}
