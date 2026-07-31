export const renameAssetUpdatedTimeMigration = Object.freeze({
  version: 9,
  sql: `
    ALTER TABLE assets
      RENAME COLUMN last_used_time TO updated_time;
  `,
});
