import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

import type { JsonValue } from '../../../shared/workbench/protocol';
import { assets } from './assets';

export const workbenchStates = sqliteTable(
  'workbench_states',
  {
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    workbenchId: text('workbench_id').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    payload: text('payload', { mode: 'json' }).$type<JsonValue>().notNull(),
    updatedTime: integer('updated_time').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.workbenchId] }),
    index('workbench_states_asset_id_index').on(table.assetId),
  ],
);

export const workbenchStateData = sqliteTable(
  'workbench_state_data',
  {
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    workbenchId: text('workbench_id').notNull(),
    dataKey: text('data_key').notNull(),
    data: blob('data', { mode: 'buffer' }).notNull(),
    updatedTime: integer('updated_time').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.assetId, table.workbenchId, table.dataKey],
    }),
    index('workbench_state_data_asset_id_index').on(table.assetId),
  ],
);

export type WorkbenchStateRow = typeof workbenchStates.$inferSelect;
export type NewWorkbenchStateRow = typeof workbenchStates.$inferInsert;
export type WorkbenchStateDataRow = typeof workbenchStateData.$inferSelect;
export type NewWorkbenchStateDataRow =
  typeof workbenchStateData.$inferInsert;
