export const migrateLocalFileContentRefsMigration = Object.freeze({
  version: 6,
  sql: `
    DELETE FROM assets
    WHERE json_extract(content_ref, '$.kind') <> 'local-file';

    UPDATE assets
    SET content_ref = json_set(
      content_ref,
      '$.base',
      'absolute'
    )
    WHERE json_extract(content_ref, '$.kind') = 'local-file'
      AND json_extract(content_ref, '$.base') IS NULL;

    CREATE TRIGGER assets_content_ref_insert_guard
    BEFORE INSERT ON assets
    WHEN NOT (
      json_valid(NEW.content_ref)
      AND json_extract(NEW.content_ref, '$.kind') = 'local-file'
      AND json_extract(NEW.content_ref, '$.base')
        IN ('project-workspace', 'absolute')
      AND typeof(json_extract(NEW.content_ref, '$.path')) = 'text'
      AND length(trim(json_extract(NEW.content_ref, '$.path'))) > 0
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid Asset ContentRef');
    END;

    CREATE TRIGGER assets_content_ref_update_guard
    BEFORE UPDATE OF content_ref ON assets
    WHEN NOT (
      json_valid(NEW.content_ref)
      AND json_extract(NEW.content_ref, '$.kind') = 'local-file'
      AND json_extract(NEW.content_ref, '$.base')
        IN ('project-workspace', 'absolute')
      AND typeof(json_extract(NEW.content_ref, '$.path')) = 'text'
      AND length(trim(json_extract(NEW.content_ref, '$.path'))) > 0
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid Asset ContentRef');
    END;
  `,
});
