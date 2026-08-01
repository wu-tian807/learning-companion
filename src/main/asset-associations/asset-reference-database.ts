import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';

import {
  cloneAssetReference,
  cloneCreateAssetReferenceInput,
  type AssetReference,
  type CreateAssetReferenceInput,
} from '../../shared/asset-associations';
import type { DatabaseContext } from '../database/database-context';
import { assetReferences } from '../database/schema/asset-references';
import { AppError } from '../errors/app-error';

export interface AssetReferenceDatabaseApi {
  listByProject(projectId: string): readonly AssetReference[];
  listByAsset(projectId: string, assetId: string): readonly AssetReference[];
  create(
    projectId: string,
    assetId: string,
    input: CreateAssetReferenceInput,
  ): AssetReference;
  delete(projectId: string, referenceId: string): void;
}

export interface AssetReferenceDatabaseDependencies {
  readonly createId: () => string;
  readonly now: () => number;
}

function requireId(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`AssetReference ${field} 不能为空`);
  }

  return normalized;
}

function mapRow(row: typeof assetReferences.$inferSelect): AssetReference {
  try {
    return cloneAssetReference(row);
  } catch (error) {
    throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
  }
}

export class AssetReferenceDatabase implements AssetReferenceDatabaseApi {
  private readonly dependencies: AssetReferenceDatabaseDependencies;

  constructor(
    private readonly context: DatabaseContext,
    dependencies: Partial<AssetReferenceDatabaseDependencies> = {},
  ) {
    this.dependencies = {
      createId: dependencies.createId ?? randomUUID,
      now: dependencies.now ?? Date.now,
    };
  }

  listByProject(projectId: string): readonly AssetReference[] {
    return this.context.db
      .select()
      .from(assetReferences)
      .where(
        eq(assetReferences.projectId, requireId(projectId, 'projectId')),
      )
      .orderBy(asc(assetReferences.createdTime), asc(assetReferences.id))
      .all()
      .map(mapRow);
  }

  listByAsset(
    projectId: string,
    assetId: string,
  ): readonly AssetReference[] {
    return this.context.db
      .select()
      .from(assetReferences)
      .where(
        and(
          eq(
            assetReferences.projectId,
            requireId(projectId, 'projectId'),
          ),
          eq(assetReferences.assetId, requireId(assetId, 'assetId')),
        ),
      )
      .orderBy(asc(assetReferences.createdTime), asc(assetReferences.id))
      .all()
      .map(mapRow);
  }

  create(
    projectId: string,
    assetId: string,
    input: CreateAssetReferenceInput,
  ): AssetReference {
    const normalizedProjectId = requireId(projectId, 'projectId');
    const normalizedAssetId = requireId(assetId, 'assetId');
    let normalizedInput: CreateAssetReferenceInput;

    try {
      normalizedInput = cloneCreateAssetReferenceInput(input);
    } catch (error) {
      throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
    }

    const reference = cloneAssetReference({
      id: this.dependencies.createId(),
      projectId: normalizedProjectId,
      assetId: normalizedAssetId,
      ...normalizedInput,
      createdTime: this.dependencies.now(),
    });
    const result = this.context.db
      .insert(assetReferences)
      .values(reference)
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    return cloneAssetReference(reference);
  }

  delete(projectId: string, referenceId: string): void {
    const result = this.context.db
      .delete(assetReferences)
      .where(
        and(
          eq(
            assetReferences.projectId,
            requireId(projectId, 'projectId'),
          ),
          eq(assetReferences.id, requireId(referenceId, 'referenceId')),
        ),
      )
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
  }
}
