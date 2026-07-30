export const addProjectWorkspaceMigration = Object.freeze({
  version: 5,
  sql: `
    -- SQLite cannot add a required column before legacy rows are backfilled.
    -- Main migrates every null value before ProjectDatabase is initialized.
    ALTER TABLE projects
      ADD COLUMN workspace_path TEXT;
  `,
});
