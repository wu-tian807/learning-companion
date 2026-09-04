import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { projects } from './projects';

export const projectLearningNotes = sqliteTable('project_learning_notes', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  markdown: text('markdown').notNull(),
  revision: integer('revision').notNull(),
  updatedTime: integer('updated_time').notNull(),
});

export type ProjectLearningNoteRow =
  typeof projectLearningNotes.$inferSelect;
export type NewProjectLearningNoteRow =
  typeof projectLearningNotes.$inferInsert;
