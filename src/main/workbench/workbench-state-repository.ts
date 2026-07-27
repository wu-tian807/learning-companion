import type { JsonValue } from '../../shared/workbench/protocol';
import { AppError } from '../errors/app-error';

export interface WorkbenchStateRecord {
  readonly assetId: string;
  readonly workbenchId: string;
  readonly schemaVersion: number;
  readonly payload: JsonValue;
  readonly updatedTime: Date;
}

export interface WorkbenchStateRepository {
  get(
    assetId: string,
    workbenchId: string,
  ): Promise<WorkbenchStateRecord | undefined>;
  save(record: WorkbenchStateRecord): Promise<void>;
  delete(assetId: string, workbenchId: string): Promise<void>;
}

export class EmptyWorkbenchStateRepository
  implements WorkbenchStateRepository
{
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
