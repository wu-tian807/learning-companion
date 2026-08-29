import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import { AppError } from '../../main/errors/app-error';

const CHECKPOINT_VERSION = 1;
// This directory is a persisted compatibility contract, not a Workbench owner.
const CHECKPOINT_ROOT = '.learning-companion/checkpoints/video-dubbing';

export interface MediaDubbingCheckpointIdentity {
  readonly workspacePath: string;
  readonly assetId: string;
  readonly sourceRevision: string;
  readonly producerVersion: string;
  readonly phrasePlannerVersion: number;
  readonly phrasesRevision: string;
  readonly totalPhrases: number;
}

export interface MediaDubbingCheckpointManifest {
  readonly durationMs: number;
}

export interface MediaDubbingCheckpointPaths {
  readonly directory: string;
  readonly manifestPath: string;
  readonly originalAudioPath: string;
  readonly stemsDirectory: string;
  readonly backgroundPath: string;
  readonly vocalsPath: string;
  readonly referencePath: string;
  readonly voiceDirectory: string;
  readonly voicePath: string;
  readonly previewPath: string;
  readonly progressPath: string;
}

interface StoredManifest extends MediaDubbingCheckpointManifest {
  readonly version: typeof CHECKPOINT_VERSION;
  readonly sourceRevision: string;
  readonly producerVersion: string;
  readonly phrasePlannerVersion: number;
  readonly phrasesRevision: string;
  readonly totalPhrases: number;
}

function requireSegment(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(normalized)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return normalized;
}

function pathsFor(
  identity: MediaDubbingCheckpointIdentity,
): MediaDubbingCheckpointPaths {
  if (!isAbsolute(identity.workspacePath)) {
    throw new AppError('PROJECT_WORKSPACE_UNAVAILABLE');
  }
  const directory = join(
    identity.workspacePath,
    ...CHECKPOINT_ROOT.split('/'),
    requireSegment(identity.assetId),
    requireSegment(identity.sourceRevision),
  );
  const stemsDirectory = join(directory, 'stems');
  const voiceDirectory = join(directory, 'voice');
  return Object.freeze({
    directory,
    manifestPath: join(directory, 'checkpoint.json'),
    originalAudioPath: join(directory, 'original.wav'),
    stemsDirectory,
    backgroundPath: join(stemsDirectory, 'background.wav'),
    vocalsPath: join(stemsDirectory, 'vocals.wav'),
    referencePath: join(directory, 'reference.wav'),
    voiceDirectory,
    voicePath: join(voiceDirectory, 'voice.wav'),
    previewPath: join(directory, 'preview.wav'),
    progressPath: join(directory, 'progress.json'),
  });
}

function isMatchingManifest(
  value: unknown,
  identity: MediaDubbingCheckpointIdentity,
): value is StoredManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.version === CHECKPOINT_VERSION &&
    record.sourceRevision === identity.sourceRevision &&
    record.producerVersion === identity.producerVersion &&
    record.phrasePlannerVersion === identity.phrasePlannerVersion &&
    record.phrasesRevision === identity.phrasesRevision &&
    record.totalPhrases === identity.totalPhrases &&
    Number.isSafeInteger(record.durationMs) &&
    Number(record.durationMs) > 0
  );
}

export async function openMediaDubbingCheckpoint(
  identity: MediaDubbingCheckpointIdentity,
): Promise<{
  readonly paths: MediaDubbingCheckpointPaths;
  readonly manifest?: MediaDubbingCheckpointManifest;
}> {
  const paths = pathsFor(identity);
  let manifest: StoredManifest | undefined;
  try {
    const parsed = JSON.parse(
      await readFile(paths.manifestPath, 'utf8'),
    ) as unknown;
    if (!isMatchingManifest(parsed, identity)) {
      throw new Error('checkpoint manifest mismatch');
    }
    await Promise.all([
      access(paths.backgroundPath),
      access(paths.referencePath),
    ]);
    manifest = parsed;
  } catch {
    await rm(paths.directory, { recursive: true, force: true });
  }
  await Promise.all([
    mkdir(paths.stemsDirectory, { recursive: true }),
    mkdir(paths.voiceDirectory, { recursive: true }),
  ]);
  return Object.freeze({
    paths,
    ...(manifest ? { manifest: { durationMs: manifest.durationMs } } : {}),
  });
}

export async function loadMediaDubbingCheckpoint(
  identity: MediaDubbingCheckpointIdentity,
): Promise<
  | {
      readonly paths: MediaDubbingCheckpointPaths;
      readonly manifest: MediaDubbingCheckpointManifest;
    }
  | undefined
> {
  const paths = pathsFor(identity);
  try {
    const parsed = JSON.parse(
      await readFile(paths.manifestPath, 'utf8'),
    ) as unknown;
    if (!isMatchingManifest(parsed, identity)) return undefined;
    await Promise.all([
      access(paths.backgroundPath),
      access(paths.referencePath),
    ]);
    return Object.freeze({
      paths,
      manifest: Object.freeze({ durationMs: parsed.durationMs }),
    });
  } catch {
    return undefined;
  }
}

export async function markMediaDubbingCheckpointPrepared(
  paths: MediaDubbingCheckpointPaths,
  identity: MediaDubbingCheckpointIdentity,
  durationMs: number,
): Promise<void> {
  const manifest: StoredManifest = {
    version: CHECKPOINT_VERSION,
    sourceRevision: identity.sourceRevision,
    producerVersion: identity.producerVersion,
    phrasePlannerVersion: identity.phrasePlannerVersion,
    phrasesRevision: identity.phrasesRevision,
    totalPhrases: identity.totalPhrases,
    durationMs,
  };
  await writeFileAtomic(
    paths.manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: 'utf8' },
  );
}

export async function removeMediaDubbingCheckpoint(
  identity: MediaDubbingCheckpointIdentity,
): Promise<void> {
  await rm(pathsFor(identity).directory, { recursive: true, force: true });
}
