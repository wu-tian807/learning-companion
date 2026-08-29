import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../main/artifacts/asset-artifact-service';
import type { AssetServiceApi } from '../../main/assets/asset-service';
import { createFileContentRevision } from '../../main/content/content-revision';
import { AppError } from '../../main/errors/app-error';
import type { ProjectLookup } from '../../main/projects/project-database';
import { SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE } from './contracts';
import {
  MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
  MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID,
} from './transcription-producer';
import { readSubtitleSourceTrackFile } from './subtitle-artifact-files';
import type { SubtitleSourceTrackV1 } from './contracts';

export interface ResolvedMediaSubtitleSource {
  readonly request: AssetArtifactRequest;
  readonly artifact: ResolvedAssetArtifact;
  readonly track: SubtitleSourceTrackV1;
}

export async function createMediaSubtitleSourceArtifactRequest(
  assets: AssetServiceApi,
  projects: ProjectLookup,
  projectId: string,
  assetId: string,
  signal?: AbortSignal,
): Promise<AssetArtifactRequest> {
  signal?.throwIfAborted();
  const asset = assets.get(assetId);
  const project = projects.get(projectId);
  if (!asset || asset.projectId !== projectId) {
    throw new AppError('ASSET_NOT_FOUND');
  }
  if (!project) throw new AppError('PROJECT_NOT_FOUND');

  const content = await assets.resolveContent(assetId);
  try {
    signal?.throwIfAborted();
    if (
      content.contentStatus.availability !== 'available' ||
      content.location?.kind !== 'local-file'
    ) {
      throw new AppError('ASSET_UNAVAILABLE');
    }
    const revision = await createFileContentRevision(
      content.location.absolutePath,
      signal,
    );
    return Object.freeze({
      assetId,
      producerId: MEDIA_SUBTITLE_TRANSCRIPTION_PRODUCER_ID,
      artifactKey: MEDIA_SUBTITLE_SOURCE_ARTIFACT_KEY,
      workspacePath: project.workspacePath,
      source: Object.freeze({
        assetId,
        mediaType: asset.mediaType,
        absolutePath: content.location.absolutePath,
        revision,
      }),
    });
  } finally {
    await content.handle?.close();
  }
}

export async function resolveCachedMediaSubtitleSource(
  assets: AssetServiceApi,
  artifacts: AssetArtifactServiceApi,
  projects: ProjectLookup,
  projectId: string,
  assetId: string,
  signal?: AbortSignal,
): Promise<ResolvedMediaSubtitleSource | undefined> {
  const request = await createMediaSubtitleSourceArtifactRequest(
    assets,
    projects,
    projectId,
    assetId,
    signal,
  );
  const artifact = await artifacts.getCached(request);
  if (!artifact) return undefined;
  if (artifact.artifact.mediaType !== SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  const track = await readSubtitleSourceTrackFile(artifact.absolutePath);
  if (track.sourceRevision !== artifact.artifact.sourceRevision) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return Object.freeze({ request, artifact, track });
}
