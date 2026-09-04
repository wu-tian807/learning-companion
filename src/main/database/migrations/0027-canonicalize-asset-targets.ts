import type Database from 'better-sqlite3';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLegacyTarget(value: unknown): value is JsonRecord {
  if (!isRecord(value) || value.scope !== 'content') {
    return false;
  }

  const keys = Object.keys(value).sort();
  return (
    keys.length === 4 &&
    keys.every((key, index) =>
      key === ['anchorPayload', 'anchorType', 'anchorVersion', 'scope'][index],
    ) &&
    typeof value.anchorType === 'string' &&
    value.anchorType.trim().length > 0 &&
    Number.isSafeInteger(value.anchorVersion) &&
    Number(value.anchorVersion) > 0 &&
    value.anchorPayload !== undefined
  );
}

function canonicalize(value: unknown): { value: unknown; changed: boolean } {
  if (isLegacyTarget(value)) {
    const payload = canonicalize(value.anchorPayload);
    const anchorType = value.anchorType as string;
    return {
      value: {
        scope: 'content',
        targetType: anchorType.trim(),
        targetVersion: value.anchorVersion,
        targetPayload: payload.value,
      },
      changed: true,
    };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const result = canonicalize(entry);
      changed ||= result.changed;
      return result.value;
    });
    return { value: changed ? next : value, changed };
  }

  if (!isRecord(value)) {
    return { value, changed: false };
  }

  let changed = false;
  const next: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    const result = canonicalize(entry);
    changed ||= result.changed;
    next[key] = result.value;
  }
  return { value: changed ? next : value, changed };
}

function migrateJsonColumn(
  sqlite: Database.Database,
  table: 'asset_attachments' | 'project_conversations' | 'generation_tasks',
  idColumn: 'id',
  jsonColumn: 'target_json' | 'messages_json' | 'instruction_json',
): void {
  const rows = sqlite
    .prepare<[], { id: string; json: string }>(
      `SELECT ${idColumn} AS id, ${jsonColumn} AS json FROM ${table}`,
    )
    .all();
  const update = sqlite.prepare<[string, string]>(
    `UPDATE ${table} SET ${jsonColumn} = ? WHERE ${idColumn} = ?`,
  );

  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.json);
    } catch {
      throw new Error(`无法迁移 ${table}.${jsonColumn}：${row.id}`);
    }

    const result = canonicalize(parsed);
    if (result.changed) {
      update.run(JSON.stringify(result.value), row.id);
    }
  }
}

export const canonicalizeAssetTargetsMigration = {
  version: 27,
  sql: '',
  apply(sqlite: Database.Database): void {
    migrateJsonColumn(
      sqlite,
      'asset_attachments',
      'id',
      'target_json',
    );
    migrateJsonColumn(
      sqlite,
      'project_conversations',
      'id',
      'messages_json',
    );
    migrateJsonColumn(
      sqlite,
      'generation_tasks',
      'id',
      'instruction_json',
    );
  },
} as const;
