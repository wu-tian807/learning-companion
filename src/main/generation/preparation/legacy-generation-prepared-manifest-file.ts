import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  clonePreparedGenerationAssetReferenceBindings,
  type PreparedGenerationAssetReferenceBindings,
} from '../contracts/generation-asset-reference';
import type { GenerationTaskSnapshot } from '../generation-task';

const preparedManifestFormat =
  'learning-companion/generation-prepared-manifest';
const preparedManifestVersion = 1;

export interface LegacyGenerationPreparedManifestFileApi {
  read(
    primaryWorkspacePath: string,
    manifestRef: string,
    task: GenerationTaskSnapshot,
  ): Promise<PreparedGenerationAssetReferenceBindings>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function absoluteWorkspacePath(
  workspacePath: string,
  relativePath: string,
): string {
  return join(workspacePath, ...relativePath.split('/'));
}

/** Reads v20 control manifests for unfinished-task compatibility only. */
export class LegacyGenerationPreparedManifestFile
  implements LegacyGenerationPreparedManifestFileApi
{
  async read(
    primaryWorkspacePath: string,
    manifestRef: string,
    task: GenerationTaskSnapshot,
  ): Promise<PreparedGenerationAssetReferenceBindings> {
    const value: unknown = JSON.parse(
      await readFile(
        absoluteWorkspacePath(primaryWorkspacePath, manifestRef),
        'utf8',
      ),
    );

    if (
      !isRecord(value) ||
      value.format !== preparedManifestFormat ||
      value.version !== preparedManifestVersion ||
      value.taskId !== task.id ||
      value.projectId !== task.projectId ||
      value.definitionId !== task.definitionId ||
      value.definitionVersion !== task.definitionVersion ||
      !isRecord(value.assetReferences)
    ) {
      throw new Error('Legacy Generation prepared manifest 数据无效');
    }

    return clonePreparedGenerationAssetReferenceBindings(
      value.assetReferences as PreparedGenerationAssetReferenceBindings,
    );
  }
}
