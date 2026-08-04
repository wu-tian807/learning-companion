import { and, eq } from 'drizzle-orm';

import type { DatabaseContext } from '../database/database-context';
import { workbenchStateData } from '../database/schema/workbench-state';
import { AppError } from '../errors/app-error';

export interface WorkbenchStateDataRecord {
  readonly assetId: string;
  readonly workbenchId: string;
  readonly dataKey: string;
  readonly data: Uint8Array;
  readonly updatedTime: number;
}

export interface WorkbenchStateDataDatabaseApi {
  get(
    assetId: string,
    workbenchId: string,
    dataKey: string,
  ): Promise<WorkbenchStateDataRecord | undefined>;
  save(record: WorkbenchStateDataRecord): Promise<void>;
  delete(
    assetId: string,
    workbenchId: string,
    dataKey: string,
  ): Promise<void>;
}

function requireKey(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

function validateRecord(record: WorkbenchStateDataRecord): void {
  requireKey(record.assetId);
  requireKey(record.workbenchId);
  requireKey(record.dataKey);

  if (
    !(record.data instanceof Uint8Array) ||
    !Number.isSafeInteger(record.updatedTime) ||
    record.updatedTime < 0
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
}

export class WorkbenchStateDataDatabase
  implements WorkbenchStateDataDatabaseApi {
  constructor(private readonly context: DatabaseContext) {}

  async get(
    assetId: string,
    workbenchId: string,
    dataKey: string,
  ): Promise<WorkbenchStateDataRecord | undefined> {
    const row = this.context.db
      .select()
      .from(workbenchStateData)
      .where(
        and(
          eq(workbenchStateData.assetId, requireKey(assetId)),
          eq(workbenchStateData.workbenchId, requireKey(workbenchId)),
          eq(workbenchStateData.dataKey, requireKey(dataKey)),
        ),
      )
      .get();

    if (!row) {
      return undefined;
    }

    return {
      assetId: row.assetId,
      workbenchId: row.workbenchId,
      dataKey: row.dataKey,
      data: new Uint8Array(row.data),
      updatedTime: row.updatedTime,
    };
  }

  async save(record: WorkbenchStateDataRecord): Promise<void> {
    validateRecord(record);
    const result = this.context.db
      .insert(workbenchStateData)
      .values({
        ...record,
        data: Buffer.from(record.data),
      })
      .onConflictDoUpdate({
        target: [
          workbenchStateData.assetId,
          workbenchStateData.workbenchId,
          workbenchStateData.dataKey,
        ],
        set: {
          data: Buffer.from(record.data),
          updatedTime: record.updatedTime,
        },
      })
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
  }

  async delete(
    assetId: string,
    workbenchId: string,
    dataKey: string,
  ): Promise<void> {
    this.context.db
      .delete(workbenchStateData)
      .where(
        and(
          eq(workbenchStateData.assetId, requireKey(assetId)),
          eq(workbenchStateData.workbenchId, requireKey(workbenchId)),
          eq(workbenchStateData.dataKey, requireKey(dataKey)),
        ),
      )
      .run();
  }
}
