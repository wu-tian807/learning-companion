export const processGenerationTasksMigration = Object.freeze({
  version: 16,
  sql: `
    ALTER TABLE generation_tasks
      RENAME TO generation_tasks_v15;

    CREATE TABLE generation_tasks (
      id TEXT PRIMARY KEY
        CHECK (length(trim(id)) > 0),
      project_id TEXT NOT NULL,
      definition_id TEXT NOT NULL
        CHECK (length(trim(definition_id)) > 0),
      definition_version INTEGER NOT NULL
        CHECK (definition_version > 0),
      instruction_json TEXT NOT NULL
        CHECK (json_valid(instruction_json)),
      asset_references_json TEXT NOT NULL
        CHECK (json_valid(asset_references_json)),
      prepared_time INTEGER,
      prepared_manifest_ref TEXT,
      assigned_provider_id TEXT,
      agent_calls_json TEXT NOT NULL
        CHECK (json_valid(agent_calls_json) AND json_type(agent_calls_json) = 'array'),
      process_completed_time INTEGER,
      process_result_json TEXT,
      metrics_json TEXT NOT NULL
        CHECK (json_valid(metrics_json)),
      failure_json TEXT
        CHECK (failure_json IS NULL OR json_valid(failure_json)),
      cancelled_time INTEGER,
      created_time INTEGER NOT NULL
        CHECK (created_time >= 0),
      updated_time INTEGER NOT NULL
        CHECK (updated_time >= created_time),
      FOREIGN KEY (project_id)
        REFERENCES projects(id)
        ON DELETE CASCADE,
      CHECK (
        (prepared_time IS NULL AND prepared_manifest_ref IS NULL)
        OR (
          prepared_time IS NOT NULL
          AND prepared_time >= created_time
          AND prepared_manifest_ref IS NOT NULL
          AND length(trim(prepared_manifest_ref)) > 0
        )
      ),
      CHECK (
        process_completed_time IS NULL
        OR (
          prepared_time IS NOT NULL
          AND process_completed_time >= prepared_time
          AND (
            process_result_json IS NULL
            OR json_valid(process_result_json)
          )
        )
      ),
      CHECK (cancelled_time IS NULL OR cancelled_time >= created_time),
      CHECK (cancelled_time IS NULL OR process_completed_time IS NULL),
      CHECK (failure_json IS NULL OR process_completed_time IS NULL)
    );

    INSERT INTO generation_tasks (
      id,
      project_id,
      definition_id,
      definition_version,
      instruction_json,
      asset_references_json,
      prepared_time,
      prepared_manifest_ref,
      assigned_provider_id,
      agent_calls_json,
      process_completed_time,
      process_result_json,
      metrics_json,
      failure_json,
      cancelled_time,
      created_time,
      updated_time
    )
    SELECT
      id,
      project_id,
      definition_id,
      definition_version,
      instruction_json,
      asset_references_json,
      prepared_time,
      prepared_manifest_ref,
      assigned_provider_id,
      CASE
        WHEN agent_completed_time IS NULL THEN json_array()
        WHEN agent_provider_execution_id IS NULL THEN json_array(
          json_object(
            'callKey', 'generate',
            'purpose', 'generation',
            'completedTime', agent_completed_time,
            'sessionId', agent_session_id
          )
        )
        ELSE json_array(
          json_object(
            'callKey', 'generate',
            'purpose', 'generation',
            'completedTime', agent_completed_time,
            'sessionId', agent_session_id,
            'providerExecutionId', agent_provider_execution_id
          )
        )
      END,
      post_processed_time,
      post_process_result_json,
      metrics_json,
      CASE
        WHEN failure_json IS NULL THEN NULL
        WHEN json_extract(failure_json, '$.phase') IN ('agent', 'post-process')
          THEN json_set(failure_json, '$.phase', 'process')
        ELSE failure_json
      END,
      cancelled_time,
      created_time,
      updated_time
    FROM generation_tasks_v15;

    DROP TABLE generation_tasks_v15;

    CREATE INDEX generation_tasks_project_updated_index
      ON generation_tasks(project_id, updated_time, id);
    CREATE INDEX generation_tasks_unfinished_project_created_index
      ON generation_tasks(project_id, created_time, id)
      WHERE process_completed_time IS NULL AND cancelled_time IS NULL;
  `,
});
