import { and, asc, eq } from 'drizzle-orm';

import type { DatabaseContext } from '../database/database-context';
import { assetArtifacts } from '../database/schema/asset-artifacts';
import { AppError } from '../errors/app-error';
import {
  cloneAssetArtifact,
  cloneAssetArtifactKey,
  type AssetArtifact,
  type AssetArtifactKey,
} from './asset-artifact';

export interface AssetArtifactDatabaseApi {
  get(key: AssetArtifactKey): AssetArtifact | undefined;
  listByAsset(assetId: string): readonly AssetArtifact[];
  upsert(artifact: AssetArtifact): AssetArtifact;
  delete(key: AssetArtifactKey): void;
}

function requireAssetId(assetId: string): string {
  const normalized = assetId.trim();

  if (normalized.length === 0) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

function mapRow(row: typeof assetArtifacts.$inferSelect): AssetArtifact {
  try {
    return cloneAssetArtifact(row);
  } catch (error) {
    throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
  }
}

export class AssetArtifactDatabase implements AssetArtifactDatabaseApi {
  constructor(private readonly context: DatabaseContext) {}

  get(key: AssetArtifactKey): AssetArtifact | undefined {
    const normalizedKey = this.normalizeKey(key);
    const row = this.context.db
      .select()
      .from(assetArtifacts)
      .where(
        and(
          eq(assetArtifacts.assetId, normalizedKey.assetId),
          eq(assetArtifacts.producerId, normalizedKey.producerId),
          eq(assetArtifacts.artifactKey, normalizedKey.artifactKey),
        ),
      )
      .get();

    return row ? mapRow(row) : undefined;
  }

  listByAsset(assetId: string): readonly AssetArtifact[] {
    return this.context.db
      .select()
      .from(assetArtifacts)
      .where(eq(assetArtifacts.assetId, requireAssetId(assetId)))
      .orderBy(
        asc(assetArtifacts.producerId),
        asc(assetArtifacts.artifactKey),
      )
      .all()
      .map(mapRow);
  }

  upsert(artifact: AssetArtifact): AssetArtifact {
    let normalized: AssetArtifact;

    try {
      normalized = cloneAssetArtifact(artifact);
    } catch (error) {
      throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
    }

    const result = this.context.db
      .insert(assetArtifacts)
      .values(normalized)
      .onConflictDoUpdate({
        target: [
          assetArtifacts.assetId,
          assetArtifacts.producerId,
          assetArtifacts.artifactKey,
        ],
        set: {
          relativePath: normalized.relativePath,
          mediaType: normalized.mediaType,
          sourceRevision: normalized.sourceRevision,
          producerVersion: normalized.producerVersion,
          artifactRevision: normalized.artifactRevision,
          updatedTime: normalized.updatedTime,
        },
      })
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    return cloneAssetArtifact(normalized);
  }

  delete(key: AssetArtifactKey): void {
    const normalizedKey = this.normalizeKey(key);
    this.context.db
      .delete(assetArtifacts)
      .where(
        and(
          eq(assetArtifacts.assetId, normalizedKey.assetId),
          eq(assetArtifacts.producerId, normalizedKey.producerId),
          eq(assetArtifacts.artifactKey, normalizedKey.artifactKey),
        ),
      )
      .run();
  }

  private normalizeKey(key: AssetArtifactKey): AssetArtifactKey {
    try {
      return cloneAssetArtifactKey(key);
    } catch (error) {
      throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
    }
  }
}
