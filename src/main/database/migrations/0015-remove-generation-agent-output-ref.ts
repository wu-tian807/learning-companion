export const removeGenerationAgentOutputRefMigration = Object.freeze({
  version: 15,
  sql: `
    ALTER TABLE generation_tasks
      RENAME TO generation_tasks_v14;

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
      agent_completed_time INTEGER,
      agent_session_id TEXT,
      agent_provider_execution_id TEXT,
      post_processed_time INTEGER,
      post_process_result_json TEXT,
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
        (
          agent_completed_time IS NULL
          AND agent_session_id IS NULL
          AND agent_provider_execution_id IS NULL
        )
        OR (
          agent_completed_time IS NOT NULL
          AND prepared_time IS NOT NULL
          AND agent_completed_time >= prepared_time
          AND agent_session_id IS NOT NULL
          AND length(trim(agent_session_id)) > 0
        )
      ),
      CHECK (
        (
          post_processed_time IS NULL
          AND post_process_result_json IS NULL
        )
        OR (
          post_processed_time IS NOT NULL
          AND agent_completed_time IS NOT NULL
          AND post_processed_time >= agent_completed_time
          AND (
            post_process_result_json IS NULL
            OR json_valid(post_process_result_json)
          )
        )
      ),
      CHECK (cancelled_time IS NULL OR cancelled_time >= created_time),
      CHECK (cancelled_time IS NULL OR post_processed_time IS NULL),
      CHECK (failure_json IS NULL OR post_processed_time IS NULL)
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
      agent_completed_time,
      agent_session_id,
      agent_provider_execution_id,
      post_processed_time,
      post_process_result_json,
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
      agent_completed_time,
      agent_session_id,
      agent_provider_execution_id,
      post_processed_time,
      post_process_result_json,
      metrics_json,
      failure_json,
      cancelled_time,
      created_time,
      updated_time
    FROM generation_tasks_v14;

    DROP TABLE generation_tasks_v14;

    CREATE INDEX generation_tasks_project_updated_index
      ON generation_tasks(project_id, updated_time, id);
    CREATE INDEX generation_tasks_unfinished_project_created_index
      ON generation_tasks(project_id, created_time, id)
      WHERE post_processed_time IS NULL AND cancelled_time IS NULL;
  `,
});
