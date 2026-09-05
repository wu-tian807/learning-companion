import type { AssetArtifactServiceApi } from '../../main/artifacts/asset-artifact-service';
import { createFileContentRevision } from '../../main/content/content-revision';
import { AppError } from '../../main/errors/app-error';
import {
  SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
  SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE,
  isTranslatableSubtitleLanguage,
  oppositeSubtitleLanguage,
  type SubtitleSourceTrackV1,
  type SubtitleTranslationTrackV1,
} from './contracts';
import {
  MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
  MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID,
} from './transcription-producer';
import {
  MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
  createSubtitleTranslationArtifactKey,
} from './translation-producer';
import {
  readOrRepairSubtitleSourceArtifact,
  readSubtitleTranslationTrackFile,
} from './subtitle-artifact-files';

export interface CachedSubtitleTracks {
  readonly source: SubtitleSourceTrackV1;
  readonly translation?: SubtitleTranslationTrackV1;
}

export interface CachedSubtitleTrackRequest {
  readonly assetId: string;
  readonly mediaType: string;
  readonly absolutePath: string;
  readonly workspacePath: string;
  readonly contentVersion: string;
  readonly signal?: AbortSignal;
}

export interface CachedSubtitleTrackReaderApi {
  read(
    request: CachedSubtitleTrackRequest,
  ): Promise<CachedSubtitleTracks | undefined>;
}

interface CachedContentRevision {
  readonly absolutePath: string;
  readonly contentVersion: string;
  readonly revision: string;
}

export class CachedSubtitleTrackReader implements CachedSubtitleTrackReaderApi {
  private readonly contentRevisions = new Map<string, CachedContentRevision>();

  constructor(private readonly artifacts: AssetArtifactServiceApi) {}

  async read(
    request: CachedSubtitleTrackRequest,
  ): Promise<CachedSubtitleTracks | undefined> {
    request.signal?.throwIfAborted();
    const cachedRevision = this.contentRevisions.get(request.assetId);
    let contentRevision =
      cachedRevision?.absolutePath === request.absolutePath &&
      cachedRevision.contentVersion === request.contentVersion
        ? cachedRevision.revision
        : undefined;
    if (contentRevision === undefined) {
      const revision = await createFileContentRevision(
        request.absolutePath,
        request.signal,
      );
      contentRevision = revision;
      this.contentRevisions.set(request.assetId, {
        absolutePath: request.absolutePath,
        contentVersion: request.contentVersion,
        revision,
      });
    }

    const sourceArtifact = await this.artifacts.getCached({
      assetId: request.assetId,
      producerId: MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID,
      artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
      workspacePath: request.workspacePath,
      source: {
        assetId: request.assetId,
        mediaType: request.mediaType,
        absolutePath: request.absolutePath,
        revision: contentRevision,
      },
    });
    if (!sourceArtifact) return undefined;
    if (
      sourceArtifact.artifact.mediaType !== SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const resolvedSource = await readOrRepairSubtitleSourceArtifact(
      this.artifacts,
      {
        assetId: request.assetId,
        producerId: MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID,
        artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
        workspacePath: request.workspacePath,
        source: {
          assetId: request.assetId,
          mediaType: request.mediaType,
          absolutePath: request.absolutePath,
          revision: contentRevision,
        },
      },
      sourceArtifact,
      request.signal,
    );
    const source = resolvedSource.track;
    if (
      source.sourceRevision !==
      resolvedSource.artifact.artifact.sourceRevision
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    if (!isTranslatableSubtitleLanguage(source.language)) {
      return Object.freeze({ source });
    }

    const targetLanguage = oppositeSubtitleLanguage(source.language);
    const sourceTrackRevision = resolvedSource.artifact.artifact.artifactRevision;
    const translationArtifact = await this.artifacts.getCached({
      assetId: request.assetId,
      producerId: MEDIA_SUBTITLE_TRANSLATION_PRODUCER_ID,
      artifactKey: createSubtitleTranslationArtifactKey(
        source.language,
        targetLanguage,
      ),
      workspacePath: request.workspacePath,
      source: {
        assetId: request.assetId,
        mediaType: SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE,
        absolutePath: resolvedSource.artifact.absolutePath,
        revision: sourceTrackRevision,
      },
    });
    if (!translationArtifact) return Object.freeze({ source });
    if (
      translationArtifact.artifact.mediaType !==
      SUBTITLE_TRANSLATION_ARTIFACT_MEDIA_TYPE
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    const translation = await readSubtitleTranslationTrackFile(
      translationArtifact.absolutePath,
      source,
      sourceTrackRevision,
    );
    return Object.freeze({ source, translation });
  }
}
