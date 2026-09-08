/**
 * Version 30 was released by an earlier notebook-asset implementation.
 *
 * The finalized version 29 schema is intentionally equivalent for runtime
 * behavior. Keeping this empty migration makes both published database
 * versions converge without rewriting schema or persisted notebook data.
 */
export const finalizeProjectNotebookAssetsCompatibilityMigration = {
  version: 30,
  sql: '',
} as const;
