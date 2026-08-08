import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import {
  isJsonValue,
  type JsonValue,
} from '../../../shared/workbench/protocol';
import type { AssetServiceApi } from '../../assets/asset-service';
import { createFileContentRevision } from '../../content/content-revision';
import { AppError } from '../../errors/app-error';
import type { WorkbenchRegistry } from '../../workbench/workbench-registry';
import {
  clonePreparedGenerationAssetReferenceBindings,
  validateGenerationAssetReferenceBindings,
  validatePreparedGenerationAssetReferenceBindings,
  type GenerationAssetReferenceBindings,
  type GenerationAssetReferenceSchema,
  type PreparedGenerationAssetReference,
  type PreparedGenerationAssetReferenceBindings,
} from '../contracts/generation-asset-reference';

export interface PrepareGenerationAssetReferencesRequest {
  readonly projectId: string;
  readonly schema: GenerationAssetReferenceSchema;
  readonly bindings: GenerationAssetReferenceBindings;
  readonly primaryWorkspacePath: string;
}

export interface GenerationAssetReferencePreparerApi {
  prepare(
    request: PrepareGenerationAssetReferencesRequest,
    signal?: AbortSignal,
  ): Promise<PreparedGenerationAssetReferenceBindings>;
  verify(
    primaryWorkspacePath: string,
    schema: GenerationAssetReferenceSchema,
    bindings: PreparedGenerationAssetReferenceBindings,
    signal?: AbortSignal,
  ): Promise<PreparedGenerationAssetReferenceBindings>;
}

interface GenerationAssetReferencePreparerDependencies {
  readonly copyFile: typeof copyFile;
  readonly createFileRevision: typeof createFileContentRevision;
  readonly mkdir: typeof mkdir;
  readonly writeFileAtomic: typeof writeFileAtomic;
}

const defaultDependencies: GenerationAssetReferencePreparerDependencies = {
  copyFile,
  createFileRevision: createFileContentRevision,
  mkdir,
  writeFileAtomic,
};

function safeSourceExtension(path: string): string {
  const extension = extname(path).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/u.test(extension) ? extension : '';
}

function absoluteWorkspacePath(
  workspacePath: string,
  relativePath: string,
): string {
  return join(workspacePath, ...relativePath.split('/'));
}

function toJsonValue(value: unknown): JsonValue {
  if (!isJsonValue(value)) {
    throw new Error('Generation AssetReference JSON 数据无效');
  }

  return value;
}

export class GenerationAssetReferencePreparer
  implements GenerationAssetReferencePreparerApi
{
  private readonly dependencies: GenerationAssetReferencePreparerDependencies;

  constructor(
    private readonly assetService: AssetServiceApi,
    private readonly workbenches: WorkbenchRegistry,
    dependencies: Partial<GenerationAssetReferencePreparerDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async prepare(
    request: PrepareGenerationAssetReferencesRequest,
    signal?: AbortSignal,
  ): Promise<PreparedGenerationAssetReferenceBindings> {
    const bindings = validateGenerationAssetReferenceBindings(
      request.schema,
      request.bindings,
    );

    if (this.assetService.getActiveProjectId() !== request.projectId) {
      throw new AppError('PROJECT_CONTEXT_CHANGED');
    }

    const prepared: Record<
      string,
      readonly PreparedGenerationAssetReference[]
    > = {};

    for (const [slot, slotSchema] of Object.entries(request.schema)) {
      const references = bindings[slot] ?? [];
      const preparedSlot: PreparedGenerationAssetReference[] = [];

      for (const [index, reference] of references.entries()) {
        signal?.throwIfAborted();
        const asset = this.assetService.get(reference.assetId);

        if (!asset || asset.projectId !== request.projectId) {
          throw new AppError('ASSET_NOT_FOUND');
        }

        if (
          slotSchema.acceptedMediaTypes &&
          !slotSchema.acceptedMediaTypes.includes(asset.mediaType)
        ) {
          throw new AppError('ASSET_MEDIA_TYPE_MISMATCH');
        }

        const resolvedContent = await this.assetService.resolveContent(
          asset.id,
        );

        try {
          if (resolvedContent.contentStatus.availability !== 'available') {
            throw new AppError('ASSET_UNAVAILABLE');
          }

          const workbenchSelection = this.workbenches.select(
            asset.mediaType,
            resolvedContent.handle,
          );
          const materializedContent =
            workbenchSelection.reason === 'matched' &&
            workbenchSelection.provider.materializeContent
              ? await workbenchSelection.provider.materializeContent({
                  asset,
                  content: resolvedContent,
                  ...(signal ? { signal } : {}),
                })
              : undefined;
          const alias = `${slot}-${String(index + 1).padStart(4, '0')}`;
          const extension = safeSourceExtension(
            materializedContent?.absolutePath ??
              resolvedContent.location?.absolutePath ??
              asset.name,
          );
          const relativePath = `references/${alias}/source${extension}`;
          const destination = absoluteWorkspacePath(
            request.primaryWorkspacePath,
            relativePath,
          );
          await this.dependencies.mkdir(dirname(destination), {
            recursive: true,
          });
          await this.copyContentToWorkspace(
            resolvedContent,
            destination,
            signal,
            materializedContent?.absolutePath,
          );
          const contentRevision = await this.dependencies.createFileRevision(
            destination,
            signal,
          );
          const preparedReference = Object.freeze({
            alias,
            assetId: asset.id,
            name: asset.name,
            mediaType: asset.mediaType,
            materializedMediaType:
              materializedContent?.mediaType ?? asset.mediaType,
            contentRevision,
            relativePath,
          });
          preparedSlot.push(preparedReference);
          await this.writeMetadata(
            absoluteWorkspacePath(
              request.primaryWorkspacePath,
              `references/${alias}/metadata.json`,
            ),
            toJsonValue(preparedReference),
          );
        } finally {
          await resolvedContent.handle?.close();
        }
      }

      prepared[slot] = Object.freeze(preparedSlot);
    }

    return clonePreparedGenerationAssetReferenceBindings(prepared);
  }

  async verify(
    primaryWorkspacePath: string,
    schema: GenerationAssetReferenceSchema,
    bindings: PreparedGenerationAssetReferenceBindings,
    signal?: AbortSignal,
  ): Promise<PreparedGenerationAssetReferenceBindings> {
    const normalized = validatePreparedGenerationAssetReferenceBindings(
      schema,
      bindings,
    );

    for (const references of Object.values(normalized)) {
      for (const reference of references) {
        const revision = await this.dependencies.createFileRevision(
          absoluteWorkspacePath(
            primaryWorkspacePath,
            reference.relativePath,
          ),
          signal,
        );

        if (revision !== reference.contentRevision) {
          throw new Error(
            `Generation prepared reference ${reference.alias} 内容已改变`,
          );
        }
      }
    }

    return normalized;
  }

  private async copyContentToWorkspace(
    resolvedContent: Awaited<
      ReturnType<AssetServiceApi['resolveContent']>
    >,
    destination: string,
    signal?: AbortSignal,
    materializedPath?: string,
  ): Promise<void> {
    signal?.throwIfAborted();

    const sourcePath =
      materializedPath ?? resolvedContent.location?.absolutePath;

    if (sourcePath) {
      if (
        resolve(sourcePath) !== resolve(destination)
      ) {
        await this.dependencies.copyFile(
          sourcePath,
          destination,
        );
      }

      signal?.throwIfAborted();
      return;
    }

    if (resolvedContent.handle?.readBytes) {
      const { content } = await resolvedContent.handle.readBytes();
      signal?.throwIfAborted();
      await this.dependencies.writeFileAtomic(
        destination,
        Buffer.from(content),
      );
      return;
    }

    throw new AppError('ASSET_UNAVAILABLE');
  }

  private async writeMetadata(
    path: string,
    value: JsonValue,
  ): Promise<void> {
    await this.dependencies.writeFileAtomic(
      path,
      `${JSON.stringify(value, undefined, 2)}\n`,
      { encoding: 'utf8' },
    );
  }
}
