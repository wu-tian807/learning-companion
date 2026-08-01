import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';

import {
  cloneAssetLink,
  cloneCreateAssetLinkInput,
  type AssetLink,
  type CreateAssetLinkInput,
} from '../../shared/asset-associations';
import type { DatabaseContext } from '../database/database-context';
import { assetLinks } from '../database/schema/asset-links';
import { AppError } from '../errors/app-error';

export interface AssetLinkDatabaseApi {
  listByProject(projectId: string): readonly AssetLink[];
  listByAsset(projectId: string, assetId: string): readonly AssetLink[];
  create(
    projectId: string,
    assetId: string,
    input: CreateAssetLinkInput,
  ): AssetLink;
  delete(projectId: string, linkId: string): void;
}

export interface AssetLinkDatabaseDependencies {
  readonly createId: () => string;
  readonly now: () => number;
}

function requireId(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`AssetLink ${field} 不能为空`);
  }

  return normalized;
}

function mapRow(row: typeof assetLinks.$inferSelect): AssetLink {
  try {
    return cloneAssetLink(row);
  } catch (error) {
    throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
  }
}

export class AssetLinkDatabase implements AssetLinkDatabaseApi {
  private readonly dependencies: AssetLinkDatabaseDependencies;

  constructor(
    private readonly context: DatabaseContext,
    dependencies: Partial<AssetLinkDatabaseDependencies> = {},
  ) {
    this.dependencies = {
      createId: dependencies.createId ?? randomUUID,
      now: dependencies.now ?? Date.now,
    };
  }

  listByProject(projectId: string): readonly AssetLink[] {
    return this.context.db
      .select()
      .from(assetLinks)
      .where(eq(assetLinks.projectId, requireId(projectId, 'projectId')))
      .orderBy(asc(assetLinks.createdTime), asc(assetLinks.id))
      .all()
      .map(mapRow);
  }

  listByAsset(projectId: string, assetId: string): readonly AssetLink[] {
    return this.context.db
      .select()
      .from(assetLinks)
      .where(
        and(
          eq(assetLinks.projectId, requireId(projectId, 'projectId')),
          eq(assetLinks.assetId, requireId(assetId, 'assetId')),
        ),
      )
      .orderBy(asc(assetLinks.createdTime), asc(assetLinks.id))
      .all()
      .map(mapRow);
  }

  create(
    projectId: string,
    assetId: string,
    input: CreateAssetLinkInput,
  ): AssetLink {
    const normalizedProjectId = requireId(projectId, 'projectId');
    const normalizedAssetId = requireId(assetId, 'assetId');
    let normalizedInput: CreateAssetLinkInput;

    try {
      normalizedInput = cloneCreateAssetLinkInput(input);
    } catch (error) {
      throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
    }

    const link = cloneAssetLink({
      id: this.dependencies.createId(),
      projectId: normalizedProjectId,
      assetId: normalizedAssetId,
      ...normalizedInput,
      createdTime: this.dependencies.now(),
    });
    const result = this.context.db.insert(assetLinks).values(link).run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    return cloneAssetLink(link);
  }

  delete(projectId: string, linkId: string): void {
    const result = this.context.db
      .delete(assetLinks)
      .where(
        and(
          eq(assetLinks.projectId, requireId(projectId, 'projectId')),
          eq(assetLinks.id, requireId(linkId, 'linkId')),
        ),
      )
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
  }
}
