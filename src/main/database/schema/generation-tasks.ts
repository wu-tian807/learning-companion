import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { JsonValue } from '../../../shared/workbench/protocol';
import type { GenerationAssetReferenceBindings } from '../../generation/contracts/generation-asset-reference';
import type { GenerationTaskMetrics } from '../../generation/contracts/generation-metrics';
import type { GenerationTaskFailure } from '../../generation/generation-task';
import { projects } from './projects';

export const generationTasks = sqliteTable(
  'generation_tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    definitionId: text('definition_id').notNull(),
    definitionVersion: integer('definition_version').notNull(),
    instruction: text('instruction_json', { mode: 'json' })
      .$type<JsonValue>()
      .notNull(),
    assetReferences: text('asset_references_json', { mode: 'json' })
      .$type<GenerationAssetReferenceBindings>()
      .notNull(),
    preparedTime: integer('prepared_time'),
    preparedManifestRef: text('prepared_manifest_ref'),
    assignedProviderId: text('assigned_provider_id'),
    agentCompletedTime: integer('agent_completed_time'),
    agentSessionId: text('agent_session_id'),
    agentProviderExecutionId: text('agent_provider_execution_id'),
    postProcessedTime: integer('post_processed_time'),
    postProcessResult: text('post_process_result_json', {
      mode: 'json',
    }).$type<JsonValue>(),
    metrics: text('metrics_json', { mode: 'json' })
      .$type<GenerationTaskMetrics>()
      .notNull(),
    failure: text('failure_json', { mode: 'json' })
      .$type<GenerationTaskFailure>(),
    cancelledTime: integer('cancelled_time'),
    createdTime: integer('created_time').notNull(),
    updatedTime: integer('updated_time').notNull(),
  },
  (table) => [
    index('generation_tasks_project_updated_index').on(
      table.projectId,
      table.updatedTime,
      table.id,
    ),
    index('generation_tasks_unfinished_project_created_index')
      .on(table.projectId, table.createdTime, table.id)
      .where(
        sql`${table.postProcessedTime} IS NULL AND ${table.cancelledTime} IS NULL`,
      ),
  ],
);

export type GenerationTaskRow = typeof generationTasks.$inferSelect;
export type NewGenerationTaskRow = typeof generationTasks.$inferInsert;
