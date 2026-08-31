import { createHash } from 'node:crypto';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  AssetArtifactProduceRequest,
  AssetArtifactProducer,
  ProducedAssetArtifact,
} from '../../../main/artifacts/asset-artifact-registry';
import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../../main/artifacts/asset-artifact-service';
import { AppError } from '../../../main/errors/app-error';
import {
  ExternalCommandRunner,
  type ExternalCommandRunnerApi,
} from '../../../main/external-libraries/external-command-runner';
import type {
  SubtitleSourceTrackV1,
  SubtitleTranslationTrackV1,
} from '../../media-subtitles/contracts';
import type { MediaSubtitleRuntimeResolverApi } from '../../media-subtitles/external-libraries/media-subtitle-runtime';
import {
  DUBBING_PHRASE_PLANNER_VERSION,
  createDubbingPhrases,
  selectDubbingReferenceWindow,
} from './dubbing-phrase-planner';
import type { VoxCpm2DubbingRuntimeResolverApi } from './external-libraries/voxcpm2-runtime';
import {
  markVideoDubbingCheckpointPrepared,
  loadVideoDubbingCheckpoint,
  openVideoDubbingCheckpoint,
  removeVideoDubbingCheckpoint,
  type VideoDubbingCheckpointIdentity,
} from './video-dubbing-checkpoint-file';
import { SOURCE_SEPARATION_WORKER_SOURCE } from './voxcpm2-worker-sources';

export const VOXCPM2_DUBBING_PRODUCER_ID = 'builtin.video.dubbing.voxcpm2';
export const VOXCPM2_DUBBING_PRODUCER_VERSION = '2';
export const VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE = 'audio/mp4';

const PROCESS_TIMEOUT_MS = 4 * 60 * 60 * 1_000;
const PROGRESS_POLL_MS = 500;

export type VideoDubbingProgressPhase =
  'preparing-runtime' | 'separating' | 'cloning' | 'mixing';

export interface VideoDubbingProgress {
  readonly assetId: string;
  readonly sourceRevision: string;
  readonly phase: VideoDubbingProgressPhase;
  readonly completedPhrases: number;
  readonly totalPhrases: number;
  readonly completedDurationMs: number;
  readonly durationMs: number;
  readonly readySuffixStartMs: number;
  readonly previewAudioPath?: string;
}

export type InterruptedVideoDubbingProgress = Omit<
  VideoDubbingProgress,
  'phase'
>;

export class VideoDubbingProgressHub {
  private readonly listeners = new Set<
    (progress: VideoDubbingProgress) => void
  >();

  publish(progress: VideoDubbingProgress): void {
    for (const listener of this.listeners) listener(progress);
  }

  subscribe(listener: (progress: VideoDubbingProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

interface DubbingInput {
  readonly sourceTrack: SubtitleSourceTrackV1;
  readonly translation: SubtitleTranslationTrackV1;
  readonly subtitleRuntime: MediaSubtitleRuntimeResolverApi;
  readonly dubbingRuntime: VoxCpm2DubbingRuntimeResolverApi;
  readonly fingerprint: string;
  consumers: number;
}

interface WorkerProgress {
  readonly completedPhrases: number;
  readonly totalPhrases: number;
  readonly completedDurationMs: number;
  readonly readySuffixStartMs: number;
  readonly previewReady: true;
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

function checkpointIdentity(
  request: AssetArtifactRequest | AssetArtifactProduceRequest,
  phrases: readonly unknown[],
): VideoDubbingCheckpointIdentity {
  return Object.freeze({
    workspacePath: request.workspacePath,
    assetId: request.source.assetId,
    sourceRevision: request.source.revision,
    producerVersion: VOXCPM2_DUBBING_PRODUCER_VERSION,
    phrasePlannerVersion: DUBBING_PHRASE_PLANNER_VERSION,
    phrasesRevision: createHash('sha256')
      .update(JSON.stringify(phrases))
      .digest('hex'),
    totalPhrases: phrases.length,
  });
}

export function createVoxCpm2DubbingArtifactKey(
  targetLanguage: 'zh-Hans' | 'en',
): string {
  return `dubbing.voxcpm2.${targetLanguage}.quality`;
}

function isWorkerProgress(value: unknown): value is WorkerProgress {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(record.completedPhrases) &&
    Number(record.completedPhrases) >= 0 &&
    Number.isSafeInteger(record.totalPhrases) &&
    Number(record.totalPhrases) >= Number(record.completedPhrases) &&
    Number.isSafeInteger(record.completedDurationMs) &&
    Number(record.completedDurationMs) >= 0 &&
    Number.isSafeInteger(record.readySuffixStartMs) &&
    Number(record.readySuffixStartMs) >= 0 &&
    record.previewReady === true
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

export interface VoxCpm2DubbingProducerDependencies {
  readonly commandRunner: ExternalCommandRunnerApi;
  readonly readText: typeof readFile;
  readonly writeText: typeof writeFile;
}

export class VoxCpm2DubbingProducer implements AssetArtifactProducer {
  readonly id = VOXCPM2_DUBBING_PRODUCER_ID;
  readonly version = VOXCPM2_DUBBING_PRODUCER_VERSION;
  private readonly pending = new Map<string, DubbingInput>();
  private readonly dependencies: VoxCpm2DubbingProducerDependencies;

  constructor(
    private readonly progress: VideoDubbingProgressHub,
    dependencies: Partial<VoxCpm2DubbingProducerDependencies> = {},
  ) {
    this.dependencies = {
      commandRunner: dependencies.commandRunner ?? new ExternalCommandRunner(),
      readText: dependencies.readText ?? readFile,
      writeText: dependencies.writeText ?? writeFile,
    };
  }

  async materialize(
    artifacts: AssetArtifactServiceApi,
    request: AssetArtifactRequest,
    sourceTrack: SubtitleSourceTrackV1,
    translation: SubtitleTranslationTrackV1,
    subtitleRuntime: MediaSubtitleRuntimeResolverApi,
    dubbingRuntime: VoxCpm2DubbingRuntimeResolverApi,
    signal?: AbortSignal,
  ): Promise<ResolvedAssetArtifact> {
    if (
      request.artifactKey !==
      createVoxCpm2DubbingArtifactKey(translation.targetLanguage)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    const key = requestKey(request);
    const fingerprint = JSON.stringify([sourceTrack, translation]);
    const active = this.pending.get(key);
    if (active && active.fingerprint !== fingerprint) {
      throw new AppError('REGISTRATION_CONFLICT');
    }
    const pending = active ?? {
      sourceTrack,
      translation,
      subtitleRuntime,
      dubbingRuntime,
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

  async removeCheckpoint(
    request: AssetArtifactRequest,
    sourceTrack: SubtitleSourceTrackV1,
    translation: SubtitleTranslationTrackV1,
  ): Promise<void> {
    const phrases = createDubbingPhrases(sourceTrack.cues, translation);
    await removeVideoDubbingCheckpoint(checkpointIdentity(request, phrases));
  }

  async getInterruptedProgress(
    request: AssetArtifactRequest,
    sourceTrack: SubtitleSourceTrackV1,
    translation: SubtitleTranslationTrackV1,
  ): Promise<InterruptedVideoDubbingProgress | undefined> {
    const phrases = createDubbingPhrases(sourceTrack.cues, translation);
    if (phrases.length === 0) return undefined;
    const checkpoint = await loadVideoDubbingCheckpoint(
      checkpointIdentity(request, phrases),
    );
    if (!checkpoint) return undefined;

    const durationMs = checkpoint.manifest.durationMs;
    const stored = await this.readWorkerProgress(
      checkpoint.paths.progressPath,
    );
    const progress =
      stored?.totalPhrases === phrases.length &&
      stored.completedDurationMs <= durationMs &&
      stored.readySuffixStartMs + stored.completedDurationMs === durationMs
        ? stored
        : undefined;
    const hasPreview =
      progress !== undefined &&
      progress.completedPhrases > 0 &&
      (await access(checkpoint.paths.previewPath).then(
        () => true,
        () => false,
      ));
    return Object.freeze({
      assetId: request.source.assetId,
      sourceRevision: request.source.revision,
      completedPhrases: progress?.completedPhrases ?? 0,
      totalPhrases: phrases.length,
      completedDurationMs: progress?.completedDurationMs ?? 0,
      durationMs,
      readySuffixStartMs: progress?.readySuffixStartMs ?? durationMs,
      ...(hasPreview
        ? { previewAudioPath: checkpoint.paths.previewPath }
        : {}),
    });
  }

  async produce(
    request: AssetArtifactProduceRequest,
    signal: AbortSignal,
  ): Promise<ProducedAssetArtifact> {
    const input = this.pending.get(requestKey(request));
    if (!input) {
      throw new AppError('DATA_INTEGRITY_ERROR', {
        cause: new Error('VoxCPM2 配音 Artifact 缺少已校验输入'),
      });
    }
    signal.throwIfAborted();

    try {
      const phrases = createDubbingPhrases(
        input.sourceTrack.cues,
        input.translation,
      );
      if (phrases.length === 0) throw new Error('没有可生成的配音段落');
      this.publish(request, 'preparing-runtime', 0, phrases.length, 0, 0, 0);
      const [decoder, runtime] = await Promise.all([
        input.subtitleRuntime.requireMediaDecoder(),
        input.dubbingRuntime.requireRuntime(),
      ]);
      signal.throwIfAborted();
      const identity = checkpointIdentity(request, phrases);
      const checkpoint = await openVideoDubbingCheckpoint(identity);
      const separationWorker = join(request.stagingDirectory, 'separate.py');
      const phrasesPath = join(request.stagingDirectory, 'phrases.json');
      await Promise.all([
        this.dependencies.writeText(
          separationWorker,
          SOURCE_SEPARATION_WORKER_SOURCE,
          'utf8',
        ),
        this.dependencies.writeText(
          phrasesPath,
          `${JSON.stringify({ phrases }, null, 2)}\n`,
          'utf8',
        ),
      ]);
      let durationMs = checkpoint.manifest?.durationMs;
      if (durationMs === undefined) {
        const probe = await this.dependencies.commandRunner.run({
          command: decoder.ffprobePath,
          args: [
            '-v',
            'error',
            '-show_entries',
            'format=duration',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            request.source.absolutePath,
          ],
          timeoutMs: 60_000,
          signal,
        });
        durationMs = Math.round(Number(probe.stdout.trim()) * 1_000);
        if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
          throw new Error('无法读取视频时长');
        }
        this.publish(
          request,
          'separating',
          0,
          phrases.length,
          0,
          durationMs,
          durationMs,
        );
        await this.dependencies.commandRunner.run({
          command: decoder.ffmpegPath,
          args: [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            request.source.absolutePath,
            '-vn',
            '-ar',
            '44100',
            '-ac',
            '2',
            '-af',
            `apad=pad_dur=${(durationMs / 1_000).toFixed(3)}`,
            '-t',
            (durationMs / 1_000).toFixed(3),
            '-c:a',
            'pcm_s16le',
            checkpoint.paths.originalAudioPath,
          ],
          timeoutMs: PROCESS_TIMEOUT_MS,
          signal,
        });
        await this.dependencies.commandRunner.run({
          command: runtime.pythonPath,
          args: [
            separationWorker,
            '--input',
            checkpoint.paths.originalAudioPath,
            '--model',
            runtime.separationModelPath,
            '--output',
            checkpoint.paths.stemsDirectory,
          ],
          cwd: request.stagingDirectory,
          env: runtime.environment,
          timeoutMs: PROCESS_TIMEOUT_MS,
          signal,
        });

        const reference = selectDubbingReferenceWindow(input.sourceTrack.cues);
        await this.dependencies.commandRunner.run({
          command: decoder.ffmpegPath,
          args: [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-ss',
            (reference.startMs / 1_000).toFixed(3),
            '-t',
            ((reference.endMs - reference.startMs) / 1_000).toFixed(3),
            '-i',
            checkpoint.paths.vocalsPath,
            '-ar',
            '16000',
            '-ac',
            '1',
            '-c:a',
            'pcm_s16le',
            checkpoint.paths.referencePath,
          ],
          timeoutMs: 5 * 60 * 1_000,
          signal,
        });
        await markVideoDubbingCheckpointPrepared(
          checkpoint.paths,
          identity,
          durationMs,
        );
        await Promise.all([
          rm(checkpoint.paths.originalAudioPath, { force: true }),
          rm(checkpoint.paths.vocalsPath, { force: true }),
        ]);
      }

      const storedProgress = await this.readWorkerProgress(
        checkpoint.paths.progressPath,
      );
      const resumedProgress =
        storedProgress?.totalPhrases === phrases.length &&
        storedProgress.completedDurationMs <= durationMs &&
        storedProgress.readySuffixStartMs <= durationMs
          ? storedProgress
          : undefined;

      this.publish(
        request,
        'cloning',
        resumedProgress?.completedPhrases ?? 0,
        phrases.length,
        resumedProgress?.completedDurationMs ?? 0,
        durationMs,
        resumedProgress?.readySuffixStartMs ?? durationMs,
        resumedProgress
          ? {
              audioPath: checkpoint.paths.previewPath,
            }
          : undefined,
      );
      await this.runVoiceWorker(
        input.dubbingRuntime.runVoiceJob(
          {
            referencePath: checkpoint.paths.referencePath,
            phrasesPath,
            outputDirectory: checkpoint.paths.voiceDirectory,
            progressPath: checkpoint.paths.progressPath,
            backgroundPath: checkpoint.paths.backgroundPath,
            previewPath: checkpoint.paths.previewPath,
            ffmpegPath: decoder.ffmpegPath,
            durationMs,
          },
          signal,
        ),
        checkpoint.paths.progressPath,
        request,
        durationMs,
        {
          audioPath: checkpoint.paths.previewPath,
        },
      );

      this.publish(
        request,
        'mixing',
        phrases.length,
        phrases.length,
        durationMs,
        durationMs,
        0,
        {
          audioPath: checkpoint.paths.previewPath,
        },
      );
      const outputPath = join(request.stagingDirectory, 'dubbed.m4a');
      await this.dependencies.commandRunner.run({
        command: decoder.ffmpegPath,
        args: [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          checkpoint.paths.previewPath,
          '-t',
          (durationMs / 1_000).toFixed(3),
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          outputPath,
        ],
        timeoutMs: PROCESS_TIMEOUT_MS,
        signal,
      });
      return Object.freeze({
        filePath: outputPath,
        mediaType: VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE,
        extension: 'm4a',
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (
        error instanceof AppError &&
        (error.code === 'EXTERNAL_LIBRARY_NOT_INSTALLED' ||
          error.code === 'FEATURE_NOT_SUPPORTED')
      ) {
        throw error;
      }
      throw new AppError('MEDIA_DUBBING_FAILED', { cause: error });
    }
  }

  private async runVoiceWorker(
    runningJob: Promise<void>,
    progressPath: string,
    request: AssetArtifactProduceRequest,
    durationMs: number,
    preview: {
      readonly audioPath: string;
    },
  ): Promise<void> {
    let settled = false;
    let lastCompleted = -1;
    const running = runningJob.finally(() => {
      settled = true;
    });
    while (!settled) {
      await Promise.race([running, delay(PROGRESS_POLL_MS)]);
      const parsed = await this.readWorkerProgress(progressPath);
      if (parsed && parsed.completedPhrases !== lastCompleted) {
        lastCompleted = parsed.completedPhrases;
        this.publish(
          request,
          'cloning',
          parsed.completedPhrases,
          parsed.totalPhrases,
          parsed.completedDurationMs,
          durationMs,
          parsed.readySuffixStartMs,
          preview,
        );
      }
    }
    await running;
  }

  private async readWorkerProgress(
    progressPath: string,
  ): Promise<WorkerProgress | undefined> {
    try {
      const parsed = JSON.parse(
        await this.dependencies.readText(progressPath, 'utf8'),
      ) as unknown;
      return isWorkerProgress(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private publish(
    request: AssetArtifactProduceRequest,
    phase: VideoDubbingProgressPhase,
    completedPhrases: number,
    totalPhrases: number,
    completedDurationMs: number,
    durationMs: number,
    readySuffixStartMs: number,
    preview?: {
      readonly audioPath: string;
    },
  ): void {
    this.progress.publish(
      Object.freeze({
        assetId: request.source.assetId,
        sourceRevision: request.source.revision,
        phase,
        completedPhrases,
        totalPhrases,
        completedDurationMs,
        durationMs,
        readySuffixStartMs,
        ...(preview
          ? {
              previewAudioPath: preview.audioPath,
            }
          : {}),
      }),
    );
  }
}

export const videoDubbingProducerMetadata = Object.freeze({
  model: 'VoxCPM2',
  phrasePlannerVersion: DUBBING_PHRASE_PLANNER_VERSION,
});
