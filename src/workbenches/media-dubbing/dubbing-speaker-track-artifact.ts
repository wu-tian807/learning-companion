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
  type SubtitleSourceTrackV1,
} from '../media-subtitles/contracts';
import {
  parseDubbingSpeakerTrack,
  type DubbingSpeakerTrackV1,
} from './dubbing-speaker-track';

export const DUBBING_SPEAKER_TRACK_PRODUCER_ID =
  'builtin.media-dubbing.speaker-track';
export const DUBBING_SPEAKER_TRACK_PRODUCER_VERSION = '1';
export const DUBBING_SPEAKER_TRACK_ARTIFACT_KEY =
  'speaker-track.voxcpm2';
export const DUBBING_SPEAKER_TRACK_ARTIFACT_MEDIA_TYPE =
  'application/vnd.learning-companion.dubbing-speaker-track+json';

interface PendingSpeakerTrack {
  readonly track: DubbingSpeakerTrackV1;
  readonly fingerprint: string;
  consumers: number;
}

export interface ResolvedDubbingSpeakerTrack {
  readonly artifact: ResolvedAssetArtifact;
  readonly track: DubbingSpeakerTrackV1;
}

export interface DubbingSpeakerTrackArtifactProducerApi {
  materialize(
    artifacts: AssetArtifactServiceApi,
    request: AssetArtifactRequest,
    source: SubtitleSourceTrackV1,
    track: DubbingSpeakerTrackV1,
    signal?: AbortSignal,
  ): Promise<ResolvedAssetArtifact>;
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
  source: SubtitleSourceTrackV1,
  track: DubbingSpeakerTrackV1,
): DubbingSpeakerTrackV1 {
  const parsed = parseDubbingSpeakerTrack(track);
  if (
    request.artifactKey !== DUBBING_SPEAKER_TRACK_ARTIFACT_KEY ||
    request.source.mediaType !== SUBTITLE_SOURCE_ARTIFACT_MEDIA_TYPE ||
    parsed.sourceTrackRevision !== request.source.revision ||
    parsed.cues.length !== source.cues.length ||
    parsed.cues.some(
      (cue, index) => cue.sourceCueId !== source.cues[index]?.id,
    )
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return parsed;
}

export async function readDubbingSpeakerTrackFile(
  path: string,
  source: SubtitleSourceTrackV1,
  sourceTrackRevision: string,
): Promise<DubbingSpeakerTrackV1> {
  const track = parseDubbingSpeakerTrack(
    JSON.parse(await readFile(path, 'utf8')) as unknown,
  );
  if (
    track.sourceTrackRevision !== sourceTrackRevision ||
    track.cues.length !== source.cues.length ||
    track.cues.some(
      (cue, index) => cue.sourceCueId !== source.cues[index]?.id,
    )
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return track;
}

export async function resolveCachedDubbingSpeakerTrack(
  artifacts: AssetArtifactServiceApi,
  request: AssetArtifactRequest,
  source: SubtitleSourceTrackV1,
): Promise<ResolvedDubbingSpeakerTrack | undefined> {
  const artifact = await artifacts.getCached(request);
  if (!artifact) return undefined;
  if (
    artifact.artifact.mediaType !==
    DUBBING_SPEAKER_TRACK_ARTIFACT_MEDIA_TYPE
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  const track = await readDubbingSpeakerTrackFile(
    artifact.absolutePath,
    source,
    request.source.revision,
  );
  return Object.freeze({ artifact, track });
}

/** Commits the already validated speaker projection through ArtifactService. */
export class DubbingSpeakerTrackArtifactProducer
  implements AssetArtifactProducer, DubbingSpeakerTrackArtifactProducerApi
{
  readonly id = DUBBING_SPEAKER_TRACK_PRODUCER_ID;
  readonly version = DUBBING_SPEAKER_TRACK_PRODUCER_VERSION;
  private readonly pending = new Map<string, PendingSpeakerTrack>();

  async materialize(
    artifacts: AssetArtifactServiceApi,
    request: AssetArtifactRequest,
    source: SubtitleSourceTrackV1,
    track: DubbingSpeakerTrackV1,
    signal?: AbortSignal,
  ): Promise<ResolvedAssetArtifact> {
    const validated = validateTrack(request, source, track);
    const key = requestKey(request);
    const fingerprint = JSON.stringify(validated);
    const active = this.pending.get(key);
    if (active && active.fingerprint !== fingerprint) {
      throw new AppError('REGISTRATION_CONFLICT');
    }
    const pending = active ?? {
      track: validated,
      fingerprint,
      consumers: 0,
    };
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
        cause: new Error('说话人轨道 Artifact 缺少已校验计划'),
      });
    }
    const filePath = join(request.stagingDirectory, 'speaker-track.json');
    await writeFile(
      filePath,
      `${JSON.stringify(pending.track, null, 2)}\n`,
      'utf8',
    );
    signal.throwIfAborted();
    return Object.freeze({
      filePath,
      mediaType: DUBBING_SPEAKER_TRACK_ARTIFACT_MEDIA_TYPE,
      extension: 'json',
    });
  }
}
