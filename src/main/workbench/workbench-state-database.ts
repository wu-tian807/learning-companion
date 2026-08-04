import { and, eq } from 'drizzle-orm';

import type { JsonValue } from '../../shared/workbench/protocol';
import { isJsonValue } from '../../shared/workbench/protocol';
import type { DatabaseContext } from '../database/database-context';
import { workbenchStates } from '../database/schema/workbench-state';
import { AppError } from '../errors/app-error';

export interface WorkbenchStateRecord {
  readonly assetId: string;
  readonly workbenchId: string;
  readonly schemaVersion: number;
  readonly payload: JsonValue;
  readonly updatedTime: number;
}

export interface WorkbenchStateDatabaseApi {
  get(
    assetId: string,
    workbenchId: string,
  ): Promise<WorkbenchStateRecord | undefined>;
  save(record: WorkbenchStateRecord): Promise<void>;
  delete(assetId: string, workbenchId: string): Promise<void>;
}

function requireKey(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

function validateRecord(record: WorkbenchStateRecord): void {
  requireKey(record.assetId);
  requireKey(record.workbenchId);

  if (
    !Number.isSafeInteger(record.schemaVersion) ||
    record.schemaVersion <= 0 ||
    !Number.isSafeInteger(record.updatedTime) ||
    record.updatedTime < 0 ||
    !isJsonValue(record.payload)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
}

export class WorkbenchStateDatabase
  implements WorkbenchStateDatabaseApi {
  constructor(private readonly context: DatabaseContext) {}

  async get(
    assetId: string,
    workbenchId: string,
  ): Promise<WorkbenchStateRecord | undefined> {
    const row = this.context.db
      .select()
      .from(workbenchStates)
      .where(
        and(
          eq(workbenchStates.assetId, requireKey(assetId)),
          eq(workbenchStates.workbenchId, requireKey(workbenchId)),
        ),
      )
      .get();

    if (!row) {
      return undefined;
    }

    const record: WorkbenchStateRecord = {
      assetId: row.assetId,
      workbenchId: row.workbenchId,
      schemaVersion: row.schemaVersion,
      payload: row.payload,
      updatedTime: row.updatedTime,
    };
    validateRecord(record);
    return record;
  }

  async save(record: WorkbenchStateRecord): Promise<void> {
    validateRecord(record);
    const result = this.context.db
      .insert(workbenchStates)
      .values(record)
      .onConflictDoUpdate({
        target: [workbenchStates.assetId, workbenchStates.workbenchId],
        set: {
          schemaVersion: record.schemaVersion,
          payload: record.payload,
          updatedTime: record.updatedTime,
        },
      })
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
  }

  async delete(assetId: string, workbenchId: string): Promise<void> {
    this.context.db
      .delete(workbenchStates)
      .where(
        and(
          eq(workbenchStates.assetId, requireKey(assetId)),
          eq(workbenchStates.workbenchId, requireKey(workbenchId)),
        ),
      )
      .run();
  }
}

export class EmptyWorkbenchStateDatabase
  implements WorkbenchStateDatabaseApi {
  async get(
    _assetId: string,
    _workbenchId: string,
  ): Promise<WorkbenchStateRecord | undefined> {
    void _assetId;
    void _workbenchId;
    return undefined;
  }

  async save(_record: WorkbenchStateRecord): Promise<void> {
    void _record;
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }

  async delete(_assetId: string, _workbenchId: string): Promise<void> {
    void _assetId;
    void _workbenchId;
    throw new AppError('FEATURE_NOT_SUPPORTED');
  }
}
