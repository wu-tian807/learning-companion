import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import { AppError } from '../../main/errors/app-error';

const CHECKPOINT_VERSION = 2;
// This directory is a persisted compatibility contract, not a Workbench owner.
const CHECKPOINT_ROOT = '.learning-companion/checkpoints/video-dubbing';

export interface MediaDubbingCheckpointIdentity {
  readonly workspacePath: string;
  readonly assetId: string;
  readonly sourceRevision: string;
  readonly producerVersion: string;
  readonly phrasePlannerVersion: number;
  readonly speakerPlannerVersion: number;
  readonly inputRevision: string;
}

export interface MediaDubbingCheckpointManifest {
  readonly durationMs: number;
  readonly totalPhrases: number;
  readonly planRevision: string;
  readonly referenceSpeakerIds: readonly string[];
}

export interface MediaDubbingCheckpointPaths {
  readonly directory: string;
  readonly manifestPath: string;
  readonly speakerPlanPath: string;
  readonly originalAudioPath: string;
  readonly stemsDirectory: string;
  readonly backgroundPath: string;
  readonly vocalsPath: string;
  readonly referencesDirectory: string;
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
  readonly speakerPlannerVersion: number;
  readonly inputRevision: string;
}

function requireSegment(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(normalized)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  return normalized;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
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
  const referencesDirectory = join(directory, 'references');
  const voiceDirectory = join(directory, 'voice');
  return Object.freeze({
    directory,
    manifestPath: join(directory, 'checkpoint.json'),
    speakerPlanPath: join(directory, 'speaker-plan.json'),
    originalAudioPath: join(directory, 'original.wav'),
    stemsDirectory,
    backgroundPath: join(stemsDirectory, 'background.wav'),
    vocalsPath: join(stemsDirectory, 'vocals.wav'),
    referencesDirectory,
    voiceDirectory,
    voicePath: join(voiceDirectory, 'voice.wav'),
    previewPath: join(directory, 'preview.wav'),
    progressPath: join(directory, 'progress.json'),
  });
}

export function mediaDubbingReferencePath(
  paths: MediaDubbingCheckpointPaths,
  speakerId: string,
): string {
  return join(paths.referencesDirectory, `${requireSegment(speakerId)}.wav`);
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
    record.speakerPlannerVersion === identity.speakerPlannerVersion &&
    record.inputRevision === identity.inputRevision &&
    Number.isSafeInteger(record.durationMs) &&
    Number(record.durationMs) > 0 &&
    Number.isSafeInteger(record.totalPhrases) &&
    Number(record.totalPhrases) > 0 &&
    isSha256(record.planRevision) &&
    Array.isArray(record.referenceSpeakerIds) &&
    new Set(record.referenceSpeakerIds).size ===
      record.referenceSpeakerIds.length &&
    record.referenceSpeakerIds.every(
      (speakerId) =>
        typeof speakerId === 'string' &&
        /^speaker-\d{4}$/u.test(speakerId),
    )
  );
}

function publicManifest(
  manifest: StoredManifest,
): MediaDubbingCheckpointManifest {
  return Object.freeze({
    durationMs: manifest.durationMs,
    totalPhrases: manifest.totalPhrases,
    planRevision: manifest.planRevision,
    referenceSpeakerIds: Object.freeze([...manifest.referenceSpeakerIds]),
  });
}

async function readMatchingManifest(
  paths: MediaDubbingCheckpointPaths,
  identity: MediaDubbingCheckpointIdentity,
): Promise<StoredManifest> {
  const parsed = JSON.parse(
    await readFile(paths.manifestPath, 'utf8'),
  ) as unknown;
  if (!isMatchingManifest(parsed, identity)) {
    throw new Error('checkpoint manifest mismatch');
  }
  const plan = await readFile(paths.speakerPlanPath, 'utf8');
  if (createHash('sha256').update(plan).digest('hex') !== parsed.planRevision) {
    throw new Error('checkpoint speaker plan mismatch');
  }
  await Promise.all([
    access(paths.backgroundPath),
    ...parsed.referenceSpeakerIds.map((speakerId) =>
      access(mediaDubbingReferencePath(paths, speakerId)),
    ),
  ]);
  return parsed;
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
    manifest = await readMatchingManifest(paths, identity);
  } catch {
    await rm(paths.directory, { recursive: true, force: true });
  }
  await Promise.all([
    mkdir(paths.stemsDirectory, { recursive: true }),
    mkdir(paths.referencesDirectory, { recursive: true }),
    mkdir(paths.voiceDirectory, { recursive: true }),
  ]);
  return Object.freeze({
    paths,
    ...(manifest ? { manifest: publicManifest(manifest) } : {}),
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
    const manifest = await readMatchingManifest(paths, identity);
    return Object.freeze({
      paths,
      manifest: publicManifest(manifest),
    });
  } catch {
    return undefined;
  }
}

export async function markMediaDubbingCheckpointPrepared(
  paths: MediaDubbingCheckpointPaths,
  identity: MediaDubbingCheckpointIdentity,
  prepared: MediaDubbingCheckpointManifest,
): Promise<void> {
  if (
    !Number.isSafeInteger(prepared.durationMs) ||
    prepared.durationMs <= 0 ||
    !Number.isSafeInteger(prepared.totalPhrases) ||
    prepared.totalPhrases <= 0 ||
    !isSha256(prepared.planRevision) ||
    new Set(prepared.referenceSpeakerIds).size !==
      prepared.referenceSpeakerIds.length ||
    prepared.referenceSpeakerIds.some(
      (speakerId) => !/^speaker-\d{4}$/u.test(speakerId),
    )
  ) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }
  await Promise.all([
    access(paths.backgroundPath),
    access(paths.speakerPlanPath),
    ...prepared.referenceSpeakerIds.map((speakerId) =>
      access(mediaDubbingReferencePath(paths, speakerId)),
    ),
  ]);
  const manifest: StoredManifest = {
    version: CHECKPOINT_VERSION,
    sourceRevision: identity.sourceRevision,
    producerVersion: identity.producerVersion,
    phrasePlannerVersion: identity.phrasePlannerVersion,
    speakerPlannerVersion: identity.speakerPlannerVersion,
    inputRevision: identity.inputRevision,
    durationMs: prepared.durationMs,
    totalPhrases: prepared.totalPhrases,
    planRevision: prepared.planRevision,
    referenceSpeakerIds: [...prepared.referenceSpeakerIds],
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
