export const createProjectsMigration = Object.freeze({
  version: 1,
  sql: `
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      created_time INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
    );
  `,
});
