export const addAssetCreationKindMigration = Object.freeze({
  version: 8,
  sql: `
    ALTER TABLE assets
      ADD COLUMN creation_kind TEXT NOT NULL
      DEFAULT 'imported'
      CHECK (creation_kind IN ('imported', 'generated'));
  `,
});
