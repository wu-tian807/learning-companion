import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import {
  isJsonValue,
  type JsonValue,
} from '../../../shared/workbench/protocol';
import type { AssetArtifactServiceApi } from '../../artifacts/asset-artifact-service';
import type { AssetServiceApi } from '../../assets/asset-service';
import { createFileContentRevision } from '../../content/content-revision';
import { AppError } from '../../errors/app-error';
import type { ProjectLookup } from '../../projects/project-database';
import type { WorkbenchRegistry } from '../../workbench/workbench-registry';
import {
  clonePreparedGenerationAssetReferenceBindings,
  validateGenerationAssetReferenceBindings,
  validatePreparedGenerationAssetReferenceBindings,
  type GenerationAssetReferenceBindings,
  type GenerationAssetReferenceSchema,
  type PreparedGenerationAssetArtifact,
  type PreparedGenerationAssetReference,
  type PreparedGenerationAssetReferenceBindings,
} from '../contracts/generation-asset-reference';
import { isAgentReadableArtifactMediaType } from './agent-readable-artifact';

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

function pathIdentity(path: string): string {
  const absolutePath = resolve(path);
  return process.platform === 'win32'
    ? absolutePath.toLocaleLowerCase('en-US')
    : absolutePath;
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
    private readonly artifacts: AssetArtifactServiceApi,
    private readonly projects: ProjectLookup,
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
    const project = this.projects.get(request.projectId);

    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND');
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
          const projectedArtifacts = await this.prepareArtifacts(
            asset.id,
            alias,
            project.workspacePath,
            request.primaryWorkspacePath,
            contentRevision,
            materializedContent?.absolutePath ??
              resolvedContent.location?.absolutePath,
            signal,
          );
          const preparedReference = Object.freeze({
            alias,
            assetId: asset.id,
            name: asset.name,
            mediaType: asset.mediaType,
            workbenchId: workbenchSelection.provider.manifest.id,
            materializedMediaType:
              materializedContent?.mediaType ?? asset.mediaType,
            contentRevision,
            relativePath,
            ...(projectedArtifacts.length === 0
              ? {}
              : { artifacts: projectedArtifacts }),
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

        for (const artifact of reference.artifacts ?? []) {
          const artifactRevision =
            await this.dependencies.createFileRevision(
              absoluteWorkspacePath(
                primaryWorkspacePath,
                artifact.relativePath,
              ),
              signal,
            );

          if (artifactRevision !== artifact.contentRevision) {
            throw new Error(
              `Generation prepared artifact ${reference.alias}/${artifact.producerId}/${artifact.artifactKey} 内容已改变`,
            );
          }
        }
      }
    }

    return normalized;
  }

  private async prepareArtifacts(
    assetId: string,
    alias: string,
    projectWorkspacePath: string,
    primaryWorkspacePath: string,
    primaryContentRevision: string,
    primarySourcePath?: string,
    signal?: AbortSignal,
  ): Promise<readonly PreparedGenerationAssetArtifact[]> {
    const available = await this.artifacts.listAvailableByAsset(
      assetId,
      projectWorkspacePath,
      {
        ...(signal ? { signal } : {}),
        acceptMediaType: isAgentReadableArtifactMediaType,
        connectedToRevision: primaryContentRevision,
      },
    );
    const skippedPaths = new Set(
      primarySourcePath ? [pathIdentity(primarySourcePath)] : [],
    );
    const prepared: PreparedGenerationAssetArtifact[] = [];

    for (const resolvedArtifact of available) {
      signal?.throwIfAborted();

      if (
        skippedPaths.has(pathIdentity(resolvedArtifact.absolutePath))
      ) {
        continue;
      }

      skippedPaths.add(pathIdentity(resolvedArtifact.absolutePath));
      const extension = safeSourceExtension(
        resolvedArtifact.absolutePath,
      );
      const relativePath =
        `references/${alias}/artifacts/` +
        `${String(prepared.length + 1).padStart(4, '0')}${extension}`;
      const destination = absoluteWorkspacePath(
        primaryWorkspacePath,
        relativePath,
      );
      await this.dependencies.mkdir(dirname(destination), {
        recursive: true,
      });
      await this.dependencies.copyFile(
        resolvedArtifact.absolutePath,
        destination,
      );
      signal?.throwIfAborted();
      const contentRevision = await this.dependencies.createFileRevision(
        destination,
        signal,
      );

      if (
        contentRevision !== resolvedArtifact.artifact.artifactRevision
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      prepared.push(
        Object.freeze({
          producerId: resolvedArtifact.artifact.producerId,
          artifactKey: resolvedArtifact.artifact.artifactKey,
          mediaType: resolvedArtifact.artifact.mediaType,
          contentRevision,
          relativePath,
        }),
      );
    }

    return Object.freeze(prepared);
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
