import { isAbsolute, normalize } from 'node:path';

import { isUnixMilliseconds } from '../../shared/projects';
import { AppError } from '../errors/app-error';
import {
  cloneAssetArtifact,
  type AssetArtifact,
  type AssetArtifactKey,
} from './asset-artifact';
import type {
  AssetArtifactDatabaseApi,
} from './asset-artifact-database';
import type {
  AssetArtifactFileManagerApi,
} from './asset-artifact-file-manager';
import type {
  AssetArtifactProducer,
  AssetArtifactRegistryApi,
  AssetArtifactSource,
} from './asset-artifact-registry';

export interface AssetArtifactRequest extends AssetArtifactKey {
  readonly workspacePath: string;
  readonly source: AssetArtifactSource;
}

export interface ResolvedAssetArtifact {
  readonly artifact: AssetArtifact;
  readonly absolutePath: string;
  readonly cacheHit: boolean;
}

export interface AssetArtifactServiceApi {
  getOrCreate(
    request: AssetArtifactRequest,
    signal?: AbortSignal,
  ): Promise<ResolvedAssetArtifact>;
}

export interface AssetArtifactServiceDependencies {
  readonly now: () => number;
  readonly logger: Pick<Console, 'warn'>;
}

interface ActiveGenerationTask {
  readonly fingerprint: string;
  readonly controller: AbortController;
  readonly promise: Promise<ResolvedAssetArtifact>;
  consumers: number;
  settled: boolean;
}

function createAbortError(): DOMException {
  return new DOMException('Asset Artifact generation cancelled', 'AbortError');
}

function requireText(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

function requireAbsolutePath(value: string): string {
  const normalized = normalize(value.trim());

  if (!isAbsolute(normalized)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

function requireMediaType(value: string): string {
  const normalized = value.trim();

  if (!/^[^\s/]+\/[^\s/]+$/u.test(normalized)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return normalized;
}

function normalizeRequest(
  request: AssetArtifactRequest,
): AssetArtifactRequest {
  const assetId = requireText(request.assetId);
  const sourceAssetId = requireText(request.source.assetId);

  if (assetId !== sourceAssetId) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return Object.freeze({
    assetId,
    producerId: requireText(request.producerId),
    artifactKey: requireText(request.artifactKey),
    workspacePath: requireAbsolutePath(request.workspacePath),
    source: Object.freeze({
      assetId: sourceAssetId,
      mediaType: requireMediaType(request.source.mediaType),
      absolutePath: requireAbsolutePath(request.source.absolutePath),
      revision: requireText(request.source.revision),
    }),
  });
}

function createTaskKey(request: AssetArtifactRequest): string {
  return JSON.stringify([
    request.assetId,
    request.producerId,
    request.artifactKey,
  ]);
}

function createTaskFingerprint(
  request: AssetArtifactRequest,
  producer: AssetArtifactProducer,
): string {
  return JSON.stringify([
    request.workspacePath,
    request.source.absolutePath,
    request.source.mediaType,
    request.source.revision,
    producer.version,
  ]);
}

export class AssetArtifactService
  implements AssetArtifactServiceApi
{
  private readonly activeTasks = new Map<string, ActiveGenerationTask>();
  private readonly now: () => number;
  private readonly logger: Pick<Console, 'warn'>;

  constructor(
    private readonly database: AssetArtifactDatabaseApi,
    private readonly fileManager: AssetArtifactFileManagerApi,
    private readonly registry: AssetArtifactRegistryApi,
    dependencies: Partial<AssetArtifactServiceDependencies> = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.logger = dependencies.logger ?? console;
  }

  async getOrCreate(
    request: AssetArtifactRequest,
    signal?: AbortSignal,
  ): Promise<ResolvedAssetArtifact> {
    if (signal?.aborted) {
      throw createAbortError();
    }

    const normalized = normalizeRequest(request);
    const producer = this.registry.require(normalized.producerId);
    const cached = await this.resolveCached(normalized, producer);

    if (cached) {
      return cached;
    }

    const taskKey = createTaskKey(normalized);
    const fingerprint = createTaskFingerprint(normalized, producer);
    const activeTask = this.activeTasks.get(taskKey);

    if (activeTask) {
      if (activeTask.fingerprint === fingerprint) {
        return this.consumeTask(activeTask, signal);
      }

      await this.waitForDifferentTask(activeTask.promise, signal);
      return this.getOrCreate(normalized, signal);
    }

    const controller = new AbortController();
    const task = {} as ActiveGenerationTask;
    const promise = this.generate(
      normalized,
      producer,
      controller.signal,
    ).finally(() => {
      task.settled = true;
      if (this.activeTasks.get(taskKey) === task) {
        this.activeTasks.delete(taskKey);
      }
    });
    Object.assign(task, {
      fingerprint,
      controller,
      promise,
      consumers: 0,
      settled: false,
    });
    this.activeTasks.set(taskKey, task);

    return this.consumeTask(task, signal);
  }

  private async resolveCached(
    request: AssetArtifactRequest,
    producer: AssetArtifactProducer,
  ): Promise<ResolvedAssetArtifact | undefined> {
    const existing = this.database.get(request);

    if (
      !existing ||
      existing.sourceRevision !== request.source.revision ||
      existing.producerVersion !== producer.version
    ) {
      return undefined;
    }

    const absolutePath = await this.fileManager.resolveValidArtifact(
      request.workspacePath,
      existing,
    );

    return absolutePath
      ? Object.freeze({
          artifact: cloneAssetArtifact(existing),
          absolutePath,
          cacheHit: true,
        })
      : undefined;
  }

  private async generate(
    request: AssetArtifactRequest,
    producer: AssetArtifactProducer,
    signal: AbortSignal,
  ): Promise<ResolvedAssetArtifact> {
    const previous = this.database.get(request);
    const stagingDirectory =
      await this.fileManager.createStagingDirectory(request.workspacePath);

    try {
      if (signal.aborted) {
        throw createAbortError();
      }

      const produced = await producer.produce(
        {
          source: request.source,
          artifactKey: request.artifactKey,
          workspacePath: request.workspacePath,
          stagingDirectory,
        },
        signal,
      );

      if (signal.aborted) {
        throw createAbortError();
      }

      const producedFilePath = requireAbsolutePath(produced.filePath);
      const producedMediaType = requireMediaType(produced.mediaType);
      const committed = await this.fileManager.commitFile({
        workspacePath: request.workspacePath,
        stagingDirectory,
        producedFilePath,
        assetId: request.assetId,
        producerId: producer.id,
        extension: produced.extension,
      });

      if (signal.aborted) {
        throw createAbortError();
      }

      const updatedTime = this.now();

      if (!isUnixMilliseconds(updatedTime)) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      const artifact = this.database.upsert({
        assetId: request.assetId,
        producerId: producer.id,
        artifactKey: request.artifactKey,
        relativePath: committed.relativePath,
        mediaType: producedMediaType,
        sourceRevision: request.source.revision,
        producerVersion: producer.version,
        artifactRevision: committed.artifactRevision,
        updatedTime,
      });

      if (
        previous &&
        previous.relativePath !== artifact.relativePath
      ) {
        await this.fileManager
          .removeArtifactFile(
            request.workspacePath,
            previous.relativePath,
          )
          .catch((error: unknown) => {
            this.logger.warn('清理旧 Asset Artifact 失败', error);
          });
      }

      return Object.freeze({
        artifact: cloneAssetArtifact(artifact),
        absolutePath: committed.absolutePath,
        cacheHit: false,
      });
    } finally {
      await this.fileManager
        .cleanupStagingDirectory(
          request.workspacePath,
          stagingDirectory,
        )
        .catch((error: unknown) => {
          this.logger.warn('清理 Asset Artifact staging 失败', error);
        });
    }
  }

  private consumeTask(
    task: ActiveGenerationTask,
    signal?: AbortSignal,
  ): Promise<ResolvedAssetArtifact> {
    if (signal?.aborted) {
      if (task.consumers === 0 && !task.settled) {
        task.controller.abort();
      }
      return Promise.reject(createAbortError());
    }

    task.consumers += 1;

    return new Promise((resolvePromise, rejectPromise) => {
      let completed = false;
      const finish = () => {
        if (completed) {
          return false;
        }

        completed = true;
        signal?.removeEventListener('abort', handleAbort);
        task.consumers -= 1;
        if (task.consumers === 0 && !task.settled) {
          task.controller.abort();
        }
        return true;
      };
      const handleAbort = () => {
        if (finish()) {
          rejectPromise(createAbortError());
        }
      };

      signal?.addEventListener('abort', handleAbort, { once: true });
      task.promise.then(
        (value) => {
          if (finish()) {
            resolvePromise(value);
          }
        },
        (error: unknown) => {
          if (finish()) {
            rejectPromise(error);
          }
        },
      );
    });
  }

  private async waitForDifferentTask(
    promise: Promise<ResolvedAssetArtifact>,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!signal) {
      await promise.catch(() => undefined);
      return;
    }

    if (signal.aborted) {
      throw createAbortError();
    }

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const handleAbort = () => {
        rejectPromise(createAbortError());
      };

      signal.addEventListener('abort', handleAbort, { once: true });
      promise.then(
        () => {
          signal.removeEventListener('abort', handleAbort);
          resolvePromise();
        },
        () => {
          signal.removeEventListener('abort', handleAbort);
          resolvePromise();
        },
      );
    });
  }
}
