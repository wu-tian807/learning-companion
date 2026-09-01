import { writeFile } from 'node:fs/promises';
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
  SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
  isTranslatableSubtitleLanguage,
  type TranslatableSubtitleLanguage,
} from './contracts';

export const MEDIA_SUBTITLE_SRT_PRODUCER_ID =
  'builtin.media-subtitles.srt';
export const MEDIA_SUBTITLE_SRT_PRODUCER_VERSION = '1';
export const SUBTITLE_SRT_ARTIFACT_MEDIA_TYPE = 'application/x-subrip';
export const MEDIA_SUBTITLE_SOURCE_SRT_ARTIFACT_KEY = 'source.srt';

export interface SubtitleSrtCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface MediaSubtitleSrtProducerApi {
  materialize(
    artifacts: AssetArtifactServiceApi,
    request: AssetArtifactRequest,
    cues: readonly SubtitleSrtCue[],
    signal?: AbortSignal,
  ): Promise<void>;
}

interface PendingSrt {
  readonly content: string;
  readonly fingerprint: string;
  consumers: number;
}

function formatSrtTimestamp(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':') + `,${String(remainder).padStart(3, '0')}`;
}

function normalizeCue(cue: SubtitleSrtCue): SubtitleSrtCue {
  const text = cue.text
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .trim();

  if (
    !Number.isSafeInteger(cue.startMs) ||
    !Number.isSafeInteger(cue.endMs) ||
    cue.startMs < 0 ||
    cue.endMs <= cue.startMs ||
    text.length === 0
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return Object.freeze({
    startMs: cue.startMs,
    endMs: cue.endMs,
    text,
  });
}

export function serializeSubtitleSrt(
  cues: readonly SubtitleSrtCue[],
): string {
  if (cues.length === 0) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return `${cues
    .map((input, index) => {
      const cue = normalizeCue(input);
      return [
        String(index + 1),
        `${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}`,
        cue.text,
      ].join('\n');
    })
    .join('\n\n')}\n`;
}

export function createSubtitleTranslationSrtArtifactKey(
  sourceLanguage: TranslatableSubtitleLanguage,
  targetLanguage: TranslatableSubtitleLanguage,
): string {
  if (sourceLanguage === targetLanguage) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return `translation.${sourceLanguage}.${targetLanguage}.quality.srt`;
}

function requestKey(
  request: AssetArtifactRequest | AssetArtifactProduceRequest,
): string {
  return JSON.stringify([
    request.workspacePath,
    request.source.assetId,
    request.artifactKey,
    request.source.revision,
  ]);
}

function validateRequest(request: AssetArtifactRequest): void {
  const isSource =
    request.artifactKey === MEDIA_SUBTITLE_SOURCE_SRT_ARTIFACT_KEY &&
    request.source.mediaType === SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE;
  const translationMatch =
    /^translation\.([^.]+)\.([^.]+)\.quality\.srt$/u.exec(
      request.artifactKey,
    );
  const isTranslation =
    translationMatch !== null &&
    isTranslatableSubtitleLanguage(translationMatch[1]) &&
    isTranslatableSubtitleLanguage(translationMatch[2]) &&
    translationMatch[1] !== translationMatch[2] &&
    request.source.mediaType === SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE;

  if (
    request.producerId !== MEDIA_SUBTITLE_SRT_PRODUCER_ID ||
    (!isSource && !isTranslation)
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
}

export function createSubtitleSrtArtifactRequest(
  assetId: string,
  workspacePath: string,
  source: ResolvedAssetArtifact,
  artifactKey: string,
): AssetArtifactRequest {
  return Object.freeze({
    assetId,
    producerId: MEDIA_SUBTITLE_SRT_PRODUCER_ID,
    artifactKey,
    workspacePath,
    source: Object.freeze({
      assetId,
      mediaType: source.artifact.mediaType,
      absolutePath: source.absolutePath,
      revision: source.artifact.artifactRevision,
    }),
  });
}

export class MediaSubtitleSrtProducer
  implements AssetArtifactProducer, MediaSubtitleSrtProducerApi
{
  readonly id = MEDIA_SUBTITLE_SRT_PRODUCER_ID;
  readonly version = MEDIA_SUBTITLE_SRT_PRODUCER_VERSION;
  private readonly pending = new Map<string, PendingSrt>();

  async materialize(
    artifacts: AssetArtifactServiceApi,
    request: AssetArtifactRequest,
    cues: readonly SubtitleSrtCue[],
    signal?: AbortSignal,
  ): Promise<void> {
    validateRequest(request);
    const content = serializeSubtitleSrt(cues);
    const key = requestKey(request);
    const fingerprint = JSON.stringify([request.source.revision, content]);
    const active = this.pending.get(key);

    if (active && active.fingerprint !== fingerprint) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    const pending = active ?? { content, fingerprint, consumers: 0 };
    pending.consumers += 1;
    this.pending.set(key, pending);

    try {
      await artifacts.getOrCreate(request, signal);
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
        cause: new Error('字幕 SRT Artifact 缺少已验证的字幕内容'),
      });
    }

    const filePath = join(request.stagingDirectory, 'subtitles.srt');
    await writeFile(filePath, pending.content, 'utf8');
    signal.throwIfAborted();
    return Object.freeze({
      filePath,
      mediaType: SUBTITLE_SRT_ARTIFACT_MEDIA_TYPE,
      extension: 'srt',
    });
  }
}
