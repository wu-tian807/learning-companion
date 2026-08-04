import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import {
  cloneJsonValue,
  isJsonValue,
  type JsonValue,
} from '../../../shared/workbench/protocol';
import {
  clonePreparedGenerationAssetReferenceBindings,
  type PreparedGenerationAssetReferenceBindings,
} from '../contracts/generation-asset-reference';
import type { GenerationTaskSnapshot } from '../generation-task';

export const GENERATION_PREPARED_MANIFEST_REF =
  'control/prepared-manifest.json';

const preparedManifestFormat =
  'learning-companion/generation-prepared-manifest';
const preparedManifestVersion = 1;

export interface GenerationPreparedManifest {
  readonly format: typeof preparedManifestFormat;
  readonly version: typeof preparedManifestVersion;
  readonly taskId: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly assetReferences: PreparedGenerationAssetReferenceBindings;
  readonly preparedData?: JsonValue;
}

export interface GenerationPreparedManifestFileApi {
  write(
    primaryWorkspacePath: string,
    task: GenerationTaskSnapshot,
    assetReferences: PreparedGenerationAssetReferenceBindings,
    preparedData?: JsonValue,
  ): Promise<GenerationPreparedManifest>;
  read(
    primaryWorkspacePath: string,
    manifestRef: string,
    task: GenerationTaskSnapshot,
  ): Promise<GenerationPreparedManifest>;
}

interface GenerationPreparedManifestFileDependencies {
  readonly mkdir: typeof mkdir;
  readonly readFile: typeof readFile;
  readonly writeFileAtomic: typeof writeFileAtomic;
}

const defaultDependencies: GenerationPreparedManifestFileDependencies = {
  mkdir,
  readFile,
  writeFileAtomic,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (!isJsonValue(value)) {
    throw new Error('Generation prepared manifest JSON 数据无效');
  }

  return cloneJsonValue(value);
}

function absoluteWorkspacePath(
  workspacePath: string,
  relativePath: string,
): string {
  return join(workspacePath, ...relativePath.split('/'));
}

function createManifest(
  task: GenerationTaskSnapshot,
  assetReferences: PreparedGenerationAssetReferenceBindings,
  preparedData?: JsonValue,
): GenerationPreparedManifest {
  return Object.freeze({
    format: preparedManifestFormat,
    version: preparedManifestVersion,
    taskId: task.id,
    projectId: task.projectId,
    definitionId: task.definitionId,
    definitionVersion: task.definitionVersion,
    assetReferences:
      clonePreparedGenerationAssetReferenceBindings(assetReferences),
    ...(preparedData === undefined
      ? {}
      : { preparedData: cloneJsonValue(preparedData) }),
  });
}

export class GenerationPreparedManifestFile
  implements GenerationPreparedManifestFileApi
{
  private readonly dependencies: GenerationPreparedManifestFileDependencies;

  constructor(
    dependencies: Partial<GenerationPreparedManifestFileDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async write(
    primaryWorkspacePath: string,
    task: GenerationTaskSnapshot,
    assetReferences: PreparedGenerationAssetReferenceBindings,
    preparedData?: JsonValue,
  ): Promise<GenerationPreparedManifest> {
    const manifest = createManifest(task, assetReferences, preparedData);
    await this.writeJson(
      absoluteWorkspacePath(
        primaryWorkspacePath,
        'request/instruction.json',
      ),
      task.instruction,
    );
    await this.writeJson(
      absoluteWorkspacePath(
        primaryWorkspacePath,
        'request/asset-references.json',
      ),
      toJsonValue(manifest.assetReferences),
    );
    await this.writeJson(
      absoluteWorkspacePath(
        primaryWorkspacePath,
        GENERATION_PREPARED_MANIFEST_REF,
      ),
      toJsonValue(manifest),
    );
    return manifest;
  }

  async read(
    primaryWorkspacePath: string,
    manifestRef: string,
    task: GenerationTaskSnapshot,
  ): Promise<GenerationPreparedManifest> {
    const value: unknown = JSON.parse(
      await this.dependencies.readFile(
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
      !isRecord(value.assetReferences) ||
      (value.preparedData !== undefined && !isJsonValue(value.preparedData))
    ) {
      throw new Error('Generation prepared manifest 数据无效');
    }

    return createManifest(
      task,
      clonePreparedGenerationAssetReferenceBindings(
        value.assetReferences as PreparedGenerationAssetReferenceBindings,
      ),
      value.preparedData,
    );
  }

  private async writeJson(path: string, value: JsonValue): Promise<void> {
    await this.dependencies.mkdir(dirname(path), { recursive: true });
    await this.dependencies.writeFileAtomic(
      path,
      `${JSON.stringify(value, undefined, 2)}\n`,
      { encoding: 'utf8' },
    );
  }
}
