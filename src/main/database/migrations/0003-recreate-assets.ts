import { createAssetsTableSql } from './0002-create-assets';

export const recreateAssetsMigration = Object.freeze({
  version: 3,
  sql: `
    DROP TABLE assets;
    ${createAssetsTableSql}
  `,
});
