import { readFile } from 'node:fs/promises';

import writeFileAtomic from 'write-file-atomic';

import type { AssetServiceApi } from '../../../main/assets/asset-service';
import { AppError } from '../../../main/errors/app-error';
import {
  cloneLearningOutlineDocument,
  isLearningOutlineDocument,
  LEARNING_OUTLINE_ASSET_MEDIA_TYPE,
  type LearningOutlineDocument,
} from '../shared';

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Owns the managed .outline document format and its Asset-backed file I/O. */
export class LearningOutlineDocumentStore {
  constructor(private readonly assets: AssetServiceApi) {}

  async read(assetId: string): Promise<LearningOutlineDocument> {
    const asset = this.requireAsset(assetId);
    const resolved = await this.assets.resolveContent(asset.id);
    try {
      if (resolved.contentStatus.availability !== 'available' || !resolved.location) {
        throw new AppError('ASSET_UNAVAILABLE');
      }
      const raw = await readFile(resolved.location.absolutePath, 'utf8');
      const value: unknown = JSON.parse(raw);
      if (!isLearningOutlineDocument(value)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }
      return cloneLearningOutlineDocument(value);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
      }
      throw error;
    } finally {
      await resolved.handle?.close();
    }
  }

  async write(assetId: string, document: LearningOutlineDocument): Promise<void> {
    const asset = this.requireAsset(assetId);
    if (!isLearningOutlineDocument(document)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    const resolved = await this.assets.resolveContent(asset.id);
    try {
      if (resolved.contentStatus.availability !== 'available' || !resolved.location) {
        throw new AppError('ASSET_UNAVAILABLE');
      }
      await writeFileAtomic(resolved.location.absolutePath, jsonBytes(document));
    } finally {
      await resolved.handle?.close();
    }
  }

  private requireAsset(assetId: string) {
    const normalized = assetId.trim();
    const asset = this.assets.get(normalized);
    if (!asset || asset.mediaType !== LEARNING_OUTLINE_ASSET_MEDIA_TYPE) {
      throw new AppError('ASSET_NOT_FOUND');
    }
    return asset;
  }
}
