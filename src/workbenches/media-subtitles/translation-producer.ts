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
  isSubtitleTranslationTrackV1,
  isTranslatableSubtitleLanguage,
  type SubtitleTranslationCueV1,
  type SubtitleTranslationTrackV1,
  type TranslatableSubtitleLanguage,
} from './contracts';

export const MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID =
  'builtin.media-subtitles.translation';
export const MEDIA_SUBTITLE_TRANSLATION_PRODUCER_VERSION = '2';

export interface SubtitleTranslationProgress {
  readonly assetId: string;
  readonly sourceTrackRevision: string;
  readonly cue: SubtitleTranslationCueV1;
  readonly completedCues: number;
  readonly totalCues: number;
}

export type SubtitleTranslationProgressListener = (
  progress: SubtitleTranslationProgress,
) => void;

export class SubtitleTranslationProgressHub {
  private readonly listeners = new Set<SubtitleTranslationProgressListener>();

  publish(progress: SubtitleTranslationProgress): void {
    for (const listener of this.listeners) listener(progress);
  }

  subscribe(listener: SubtitleTranslationProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

interface PendingTranslation {
  readonly track: SubtitleTranslationTrackV1;
  readonly fingerprint: string;
  consumers: number;
}

export function createSubtitleTranslationArtifactKey(
  sourceLanguage: TranslatableSubtitleLanguage,
  targetLanguage: TranslatableSubtitleLanguage,
): string {
  if (sourceLanguage === targetLanguage) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return `translation.${sourceLanguage}.${targetLanguage}.quality`;
}

export function parseSubtitleTranslationArtifactKey(value: string): {
  readonly sourceLanguage: TranslatableSubtitleLanguage;
  readonly targetLanguage: TranslatableSubtitleLanguage;
} {
  const match = /^translation\.([^.]+)\.([^.]+)\.quality$/u.exec(value);
  if (
    !match ||
    !isTranslatableSubtitleLanguage(match[1]) ||
    !isTranslatableSubtitleLanguage(match[2]) ||
    match[1] === match[2]
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return Object.freeze({
    sourceLanguage: match[1],
    targetLanguage: match[2],
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

function validateTrack(
  request: AssetArtifactRequest,
  track: SubtitleTranslationTrackV1,
): void {
  const languages = parseSubtitleTranslationArtifactKey(request.artifactKey);
  if (
    request.source.mediaType !== SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE ||
    !isSubtitleTranslationTrackV1(track) ||
    track.sourceTrackRevision !== request.source.revision ||
    track.sourceLanguage !== languages.sourceLanguage ||
    track.targetLanguage !== languages.targetLanguage
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
}

/**
 * Commits a translation that has already been produced and validated by a
 * GenerationTask. AssetArtifactService remains responsible for atomic file
 * commit, cache identity and stale-artifact replacement.
 */
export class MediaSubtitleTranslationProducer implements AssetArtifactProducer {
  readonly id = MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID;
  readonly version = MEDIA_SUBTITLE_TRANSLATION_PRODUCER_VERSION;
  private readonly pending = new Map<string, PendingTranslation>();

  async materialize(
    artifacts: AssetArtifactServiceApi,
    request: AssetArtifactRequest,
    track: SubtitleTranslationTrackV1,
    signal?: AbortSignal,
  ): Promise<ResolvedAssetArtifact> {
    validateTrack(request, track);
    const key = requestKey(request);
    const fingerprint = JSON.stringify(track);
    const active = this.pending.get(key);
    if (active && active.fingerprint !== fingerprint) {
      throw new AppError('REGISTRATION_CONFLICT');
    }
    const pending = active ?? { track, fingerprint, consumers: 0 };
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
        cause: new Error('字幕翻译 Artifact 缺少 GenerationTask 产物'),
      });
    }
    const filePath = join(request.stagingDirectory, 'translation.json');
    await writeFile(
      filePath,
      `${JSON.stringify(pending.track, null, 2)}\n`,
      'utf8',
    );
    signal.throwIfAborted();
    return Object.freeze({
      filePath,
      mediaType: SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
      extension: 'json',
    });
  }
}
