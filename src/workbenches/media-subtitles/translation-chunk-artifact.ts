import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  AssetArtifactProduceRequest,
  AssetArtifactProducer,
  ProducedAssetArtifact,
} from '../../main/artifacts/asset-artifact-registry';
import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import { AppError } from '../../main/errors/app-error';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  isSubtitleTranslationCueV1,
  isTranslatableSubtitleLanguage,
  type SubtitleCueV1,
  type SubtitleEngineV1,
  type SubtitleTranslationCueV1,
  type TranslatableSubtitleLanguage,
} from './contracts';

export const SUBTITLE_TRANSLATION_CHUNK_ARTIFACT_MEDIA_TYPE =
  'application/vnd.learning-companion.subtitle-translation-chunk+json';
export const MEDIA_SUBTITLE_TRANSLATION_CHUNK_PRODUCER_ID =
  'builtin.media-subtitles.translation-chunk';
export const MEDIA_SUBTITLE_TRANSLATION_CHUNK_PRODUCER_VERSION = '1';

export interface SubtitleTranslationChunkArtifactV1 {
  readonly version: 1;
  readonly kind: 'subtitle-translation-chunk';
  readonly sourceTrackRevision: string;
  readonly sourceLanguage: TranslatableSubtitleLanguage;
  readonly targetLanguage: TranslatableSubtitleLanguage;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly engine: SubtitleEngineV1;
  readonly generatedTime: number;
  readonly cues: readonly SubtitleTranslationCueV1[];
}

interface PendingTranslationChunk {
  readonly chunk: SubtitleTranslationChunkArtifactV1;
  readonly fingerprint: string;
  consumers: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isSubtitleEngine(value: unknown): value is SubtitleEngineV1 {
  return (
    isRecord(value) &&
    isRequiredText(value.id) &&
    isRequiredText(value.version) &&
    isRequiredText(value.model) &&
    isRequiredText(value.backend)
  );
}

export function isSubtitleTranslationChunkArtifactV1(
  value: unknown,
): value is SubtitleTranslationChunkArtifactV1 {
  return (
    isRecord(value) &&
    value.version === 1 &&
    value.kind === 'subtitle-translation-chunk' &&
    isRequiredText(value.sourceTrackRevision) &&
    isTranslatableSubtitleLanguage(value.sourceLanguage) &&
    isTranslatableSubtitleLanguage(value.targetLanguage) &&
    value.sourceLanguage !== value.targetLanguage &&
    isNonNegativeInteger(value.chunkIndex) &&
    isPositiveInteger(value.chunkCount) &&
    value.chunkIndex < value.chunkCount &&
    isNonNegativeInteger(value.startIndex) &&
    isPositiveInteger(value.endIndex) &&
    value.startIndex < value.endIndex &&
    isSubtitleEngine(value.engine) &&
    isNonNegativeInteger(value.generatedTime) &&
    Array.isArray(value.cues) &&
    value.cues.length === value.endIndex - value.startIndex &&
    value.cues.every(isSubtitleTranslationCueV1) &&
    new Set(value.cues.map((cue) => cue.sourceCueId)).size ===
      value.cues.length
  );
}

export function createSubtitleTranslationChunkArtifactKey(
  sourceLanguage: TranslatableSubtitleLanguage,
  targetLanguage: TranslatableSubtitleLanguage,
  chunkIndex: number,
): string {
  if (
    sourceLanguage === targetLanguage ||
    !Number.isSafeInteger(chunkIndex) ||
    chunkIndex < 0
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return `translation-chunk.${sourceLanguage}.${targetLanguage}.${String(chunkIndex).padStart(6, '0')}`;
}

function parseSubtitleTranslationChunkArtifactKey(value: string): {
  readonly sourceLanguage: TranslatableSubtitleLanguage;
  readonly targetLanguage: TranslatableSubtitleLanguage;
  readonly chunkIndex: number;
} {
  const match =
    /^translation-chunk\.([^.]+)\.([^.]+)\.(\d{6,})$/u.exec(value);
  const chunkIndex = match ? Number(match[3]) : Number.NaN;
  if (
    !match ||
    !isTranslatableSubtitleLanguage(match[1]) ||
    !isTranslatableSubtitleLanguage(match[2]) ||
    match[1] === match[2] ||
    !Number.isSafeInteger(chunkIndex)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return Object.freeze({
    sourceLanguage: match[1],
    targetLanguage: match[2],
    chunkIndex,
  });
}

export function createSubtitleTranslationChunkArtifactRequest(input: {
  readonly assetId: string;
  readonly workspacePath: string;
  readonly sourceArtifact: ResolvedAssetArtifact;
  readonly sourceLanguage: TranslatableSubtitleLanguage;
  readonly targetLanguage: TranslatableSubtitleLanguage;
  readonly chunkIndex: number;
}): AssetArtifactRequest {
  return Object.freeze({
    assetId: input.assetId,
    producerId: MEDIA_SUBTITLE_TRANSLATION_CHUNK_PRODUCER_ID,
    artifactKey: createSubtitleTranslationChunkArtifactKey(
      input.sourceLanguage,
      input.targetLanguage,
      input.chunkIndex,
    ),
    workspacePath: input.workspacePath,
    source: Object.freeze({
      assetId: input.assetId,
      mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
      absolutePath: input.sourceArtifact.absolutePath,
      revision: input.sourceArtifact.artifact.artifactRevision,
    }),
  });
}

function requestKey(
  request: AssetArtifactRequest | AssetArtifactProduceRequest,
): string {
  return JSON.stringify([
    request.source.assetId,
    request.artifactKey,
    request.source.revision,
  ]);
}

function validateChunk(
  request: AssetArtifactRequest,
  chunk: SubtitleTranslationChunkArtifactV1,
): void {
  const identity = parseSubtitleTranslationChunkArtifactKey(
    request.artifactKey,
  );
  if (
    request.source.mediaType !== SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE ||
    !isSubtitleTranslationChunkArtifactV1(chunk) ||
    chunk.sourceTrackRevision !== request.source.revision ||
    chunk.sourceLanguage !== identity.sourceLanguage ||
    chunk.targetLanguage !== identity.targetLanguage ||
    chunk.chunkIndex !== identity.chunkIndex
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
}

export async function readSubtitleTranslationChunkArtifact(
  path: string,
  input: {
    readonly sourceTrackRevision: string;
    readonly sourceLanguage: TranslatableSubtitleLanguage;
    readonly targetLanguage: TranslatableSubtitleLanguage;
    readonly chunkIndex: number;
    readonly chunkCount: number;
    readonly startIndex: number;
    readonly endIndex: number;
    readonly targets: readonly SubtitleCueV1[];
  },
): Promise<SubtitleTranslationChunkArtifactV1> {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (
    !isSubtitleTranslationChunkArtifactV1(value) ||
    value.sourceTrackRevision !== input.sourceTrackRevision ||
    value.sourceLanguage !== input.sourceLanguage ||
    value.targetLanguage !== input.targetLanguage ||
    value.chunkIndex !== input.chunkIndex ||
    value.chunkCount !== input.chunkCount ||
    value.startIndex !== input.startIndex ||
    value.endIndex !== input.endIndex ||
    value.cues.some(
      (cue, index) => cue.sourceCueId !== input.targets[index]?.id,
    )
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return value;
}

/** Persists one independently retryable subtitle-translation chunk. */
export class MediaSubtitleTranslationChunkProducer
  implements AssetArtifactProducer
{
  readonly id = MEDIA_SUBTITLE_TRANSLATION_CHUNK_PRODUCER_ID;
  readonly version = MEDIA_SUBTITLE_TRANSLATION_CHUNK_PRODUCER_VERSION;
  private readonly pending = new Map<string, PendingTranslationChunk>();

  async materialize(
    artifacts: AssetArtifactServiceApi,
    request: AssetArtifactRequest,
    chunk: SubtitleTranslationChunkArtifactV1,
    signal?: AbortSignal,
  ): Promise<ResolvedAssetArtifact> {
    validateChunk(request, chunk);
    const key = requestKey(request);
    const fingerprint = JSON.stringify(chunk);
    const active = this.pending.get(key);
    if (active && active.fingerprint !== fingerprint) {
      throw new AppError('REGISTRATION_CONFLICT');
    }
    const pending = active ?? { chunk, fingerprint, consumers: 0 };
    pending.consumers += 1;
    this.pending.set(key, pending);

    try {
      return await artifacts.getOrCreate(request, signal);
    } finally {
      pending.consumers -= 1;
      if (pending.consumers === 0 && this.pending.get(key) === pending) {
        this.pending.delete(key);
      }
    }
  }

  async produce(
    request: AssetArtifactProduceRequest,
    signal: AbortSignal,
  ): Promise<ProducedAssetArtifact> {
    signal.throwIfAborted();
    const pending = this.pending.get(requestKey(request));
    if (!pending) {
      throw new AppError('DATA_INTEGRITY_ERROR', {
        cause: new Error('字幕翻译分块 Artifact 缺少 GenerationTask 产物'),
      });
    }
    const filePath = join(request.stagingDirectory, 'translation-chunk.json');
    await writeFile(
      filePath,
      `${JSON.stringify(pending.chunk, null, 2)}\n`,
      'utf8',
    );
    signal.throwIfAborted();
    return Object.freeze({
      filePath,
      mediaType: SUBTITLE_TRANSLATION_CHUNK_ARTIFACT_MEDIA_TYPE,
      extension: 'json',
    });
  }
}
