import { createHash } from 'node:crypto';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
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
  ExternalCommandRunner,
  type ExternalCommandRunnerApi,
} from '../../main/external-libraries/external-command-runner';
import type {
  SubtitleSourceTrackV1,
  SubtitleTranslationTrackV1,
} from '../media-subtitles/contracts';
import type { MediaSubtitleRuntimeResolverApi } from '../media-subtitles/external-libraries/media-subtitle-runtime';
import {
  DUBBING_PHRASE_PLANNER_VERSION,
} from './dubbing-phrase-planner';
import {
  DUBBING_SPEAKER_PLANNER_VERSION,
  createDubbingSpeakerRoutingPlan,
  parseDubbingSpeakerRoutingPlan,
  parseDubbingSpeakerSegments,
  type DubbingSpeakerRoutingPlan,
} from './dubbing-speaker-planner';
import {
  createDubbingSpeakerTrack,
  type DubbingSpeakerTrackV1,
} from './dubbing-speaker-track';
import type { VoxCpm2DubbingRuntimeResolverApi } from './external-libraries/voxcpm2-runtime';
import {
  markMediaDubbingCheckpointPrepared,
  loadMediaDubbingCheckpoint,
  mediaDubbingReferencePath,
  openMediaDubbingCheckpoint,
  removeMediaDubbingCheckpoint,
  type MediaDubbingCheckpointIdentity,
} from './media-dubbing-checkpoint-file';
import {
  SOURCE_SEPARATION_WORKER_SOURCE,
  SPEAKER_DIARIZATION_WORKER_SOURCE,
} from './voxcpm2-worker-sources';

// Persisted producer ids are part of existing artifact cache keys.
export const VOXCPM2_DUBBING_PRODUCER_ID = 'builtin.video.dubbing.voxcpm2';
export const VOXCPM2_DUBBING_PRODUCER_VERSION = '4';
export const VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE = 'audio/mp4';

const PROCESS_TIMEOUT_MS = 4 * 60 * 60 * 1_000;
const PROGRESS_POLL_MS = 500;

export type MediaDubbingProgressPhase =
  'preparing-runtime' | 'separating' | 'cloning' | 'mixing';

export interface MediaDubbingProgress {
  readonly assetId: string;
  readonly sourceRevision: string;
  readonly phase: MediaDubbingProgressPhase;
  readonly completedPhrases: number;
  readonly totalPhrases: number;
  readonly completedDurationMs: number;
  readonly durationMs: number;
  readonly readySuffixStartMs: number;
  readonly previewAudioPath?: string;
  readonly speakerTrack?: DubbingSpeakerTrackV1;
}

export type InterruptedMediaDubbingProgress = Omit<
  MediaDubbingProgress,
  'phase'
>;

export class MediaDubbingProgressHub {
  private readonly listeners = new Set<
    (progress: MediaDubbingProgress) => void
  >();

  publish(progress: MediaDubbingProgress): void {
    for (const listener of this.listeners) listener(progress);
  }

  subscribe(listener: (progress: MediaDubbingProgress) => void): () => void {
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
  sourceTrack: SubtitleSourceTrackV1,
  translation: SubtitleTranslationTrackV1,
): MediaDubbingCheckpointIdentity {
  return Object.freeze({
    workspacePath: request.workspacePath,
    assetId: request.source.assetId,
    sourceRevision: request.source.revision,
    producerVersion: VOXCPM2_DUBBING_PRODUCER_VERSION,
    phrasePlannerVersion: DUBBING_PHRASE_PLANNER_VERSION,
    speakerPlannerVersion: DUBBING_SPEAKER_PLANNER_VERSION,
    inputRevision: createHash('sha256')
      .update(JSON.stringify([sourceTrack, translation]))
      .digest('hex'),
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
    private readonly progress: MediaDubbingProgressHub,
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
    await removeMediaDubbingCheckpoint(
      checkpointIdentity(request, sourceTrack, translation),
    );
  }

  async getInterruptedProgress(
    request: AssetArtifactRequest,
    sourceTrack: SubtitleSourceTrackV1,
    translation: SubtitleTranslationTrackV1,
  ): Promise<InterruptedMediaDubbingProgress | undefined> {
    const checkpoint = await loadMediaDubbingCheckpoint(
      checkpointIdentity(request, sourceTrack, translation),
    );
    if (!checkpoint) return undefined;

    const durationMs = checkpoint.manifest.durationMs;
    const totalPhrases = checkpoint.manifest.totalPhrases;
    const stored = await this.readWorkerProgress(
      checkpoint.paths.progressPath,
    );
    const progress =
      stored?.totalPhrases === totalPhrases &&
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
    const speakerTrack = await this.readPreparedSpeakerTrack(
      checkpoint.paths.speakerPlanPath,
      translation.sourceTrackRevision,
    );
    return Object.freeze({
      assetId: request.source.assetId,
      sourceRevision: request.source.revision,
      completedPhrases: progress?.completedPhrases ?? 0,
      totalPhrases,
      completedDurationMs: progress?.completedDurationMs ?? 0,
      durationMs,
      readySuffixStartMs: progress?.readySuffixStartMs ?? durationMs,
      speakerTrack,
      ...(hasPreview
        ? { previewAudioPath: checkpoint.paths.previewPath }
        : {}),
    });
  }

  async getPreparedSpeakerTrack(
    request: AssetArtifactRequest,
    sourceTrack: SubtitleSourceTrackV1,
    translation: SubtitleTranslationTrackV1,
  ): Promise<DubbingSpeakerTrackV1 | undefined> {
    const checkpoint = await loadMediaDubbingCheckpoint(
      checkpointIdentity(request, sourceTrack, translation),
    );
    if (!checkpoint) return undefined;
    return this.readPreparedSpeakerTrack(
      checkpoint.paths.speakerPlanPath,
      translation.sourceTrackRevision,
    );
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
      const provisionalTotal = input.sourceTrack.cues.length;
      if (provisionalTotal === 0) throw new Error('没有可生成的配音段落');
      this.publish(request, 'preparing-runtime', 0, provisionalTotal, 0, 0, 0);
      const [decoder, runtime] = await Promise.all([
        input.subtitleRuntime.requireMediaDecoder(),
        input.dubbingRuntime.requireRuntime(),
      ]);
      signal.throwIfAborted();
      const identity = checkpointIdentity(
        request,
        input.sourceTrack,
        input.translation,
      );
      const checkpoint = await openMediaDubbingCheckpoint(identity);
      let durationMs: number;
      let plan: DubbingSpeakerRoutingPlan;
      if (checkpoint.manifest) {
        durationMs = checkpoint.manifest.durationMs;
        plan = parseDubbingSpeakerRoutingPlan(
          JSON.parse(
            await this.dependencies.readText(
              checkpoint.paths.speakerPlanPath,
              'utf8',
            ),
          ) as unknown,
        );
        if (plan.phrases.length !== checkpoint.manifest.totalPhrases) {
          throw new Error('持久说话人计划与断点 phrase 数量不一致');
        }
      } else {
        const separationWorker = join(request.stagingDirectory, 'separate.py');
        const diarizationWorker = join(
          request.stagingDirectory,
          'diarize-speakers.py',
        );
        const speakerAudioPath = join(
          request.stagingDirectory,
          'speaker-analysis.wav',
        );
        const speakerResultPath = join(
          request.stagingDirectory,
          'speaker-analysis.json',
        );
        await Promise.all([
          this.dependencies.writeText(
            separationWorker,
            SOURCE_SEPARATION_WORKER_SOURCE,
            'utf8',
          ),
          this.dependencies.writeText(
            diarizationWorker,
            SPEAKER_DIARIZATION_WORKER_SOURCE,
            'utf8',
          ),
        ]);
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
          throw new Error('无法读取媒体时长');
        }
        this.publish(
          request,
          'separating',
          0,
          provisionalTotal,
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
        await this.dependencies.commandRunner.run({
          command: decoder.ffmpegPath,
          args: [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            checkpoint.paths.vocalsPath,
            '-ar',
            '16000',
            '-ac',
            '1',
            '-c:a',
            'pcm_s16le',
            speakerAudioPath,
          ],
          timeoutMs: 5 * 60 * 1_000,
          signal,
        });
        await this.dependencies.commandRunner.run({
          command: runtime.pythonPath,
          args: [
            diarizationWorker,
            '--input',
            speakerAudioPath,
            '--segmentation-model',
            runtime.speakerSegmentationModelPath,
            '--embedding-model',
            runtime.speakerEmbeddingModelPath,
            '--output',
            speakerResultPath,
          ],
          cwd: request.stagingDirectory,
          env: runtime.environment,
          timeoutMs: PROCESS_TIMEOUT_MS,
          signal,
        });
        const segments = parseDubbingSpeakerSegments(
          JSON.parse(
            await this.dependencies.readText(speakerResultPath, 'utf8'),
          ) as unknown,
          durationMs,
        );
        plan = createDubbingSpeakerRoutingPlan(
          input.sourceTrack.cues,
          input.translation,
          segments,
        );
        if (plan.phrases.length === 0) {
          throw new Error('没有可生成的配音段落');
        }
        const referenceProfiles = plan.voiceProfiles.filter(
          (profile) => profile.mode === 'reference',
        );
        await Promise.all(
          referenceProfiles.map((profile) =>
            this.dependencies.commandRunner.run({
              command: decoder.ffmpegPath,
              args: [
                '-hide_banner',
                '-loglevel',
                'error',
                '-y',
                '-ss',
                (profile.reference.startMs / 1_000).toFixed(3),
                '-t',
                (
                  (profile.reference.endMs - profile.reference.startMs) /
                  1_000
                ).toFixed(3),
                '-i',
                checkpoint.paths.vocalsPath,
                '-ar',
                '16000',
                '-ac',
                '1',
                '-c:a',
                'pcm_s16le',
                mediaDubbingReferencePath(
                  checkpoint.paths,
                  profile.speakerId,
                ),
              ],
              timeoutMs: 5 * 60 * 1_000,
              signal,
            }),
          ),
        );
        const serializedPlan = `${JSON.stringify(plan, null, 2)}\n`;
        await this.dependencies.writeText(
          checkpoint.paths.speakerPlanPath,
          serializedPlan,
          'utf8',
        );
        await markMediaDubbingCheckpointPrepared(
          checkpoint.paths,
          identity,
          {
            durationMs,
            totalPhrases: plan.phrases.length,
            planRevision: createHash('sha256')
              .update(serializedPlan)
              .digest('hex'),
            referenceSpeakerIds: referenceProfiles.map(
              ({ speakerId }) => speakerId,
            ),
          },
        );
        await Promise.all([
          rm(checkpoint.paths.originalAudioPath, { force: true }),
          rm(checkpoint.paths.vocalsPath, { force: true }),
          rm(speakerAudioPath, { force: true }),
          rm(speakerResultPath, { force: true }),
        ]);
      }

      const speakerTrack = createDubbingSpeakerTrack(
        input.translation.sourceTrackRevision,
        plan,
      );
      const phrases = plan.phrases;
      const phrasesPath = join(request.stagingDirectory, 'phrases.json');
      await this.dependencies.writeText(
        phrasesPath,
        `${JSON.stringify({ phrases }, null, 2)}\n`,
        'utf8',
      );
      const referencePaths = Object.freeze(
        Object.fromEntries(
          plan.voiceProfiles.map((profile) => [
            profile.speakerId,
            profile.mode === 'reference'
              ? mediaDubbingReferencePath(
                  checkpoint.paths,
                  profile.speakerId,
                )
              : null,
          ]),
        ),
      );

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
        speakerTrack,
      );
      await this.runVoiceWorker(
        input.dubbingRuntime.runVoiceJob(
          {
            referencePaths,
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

  private async readPreparedSpeakerTrack(
    speakerPlanPath: string,
    sourceTrackRevision: string,
  ): Promise<DubbingSpeakerTrackV1> {
    const plan = parseDubbingSpeakerRoutingPlan(
      JSON.parse(
        await this.dependencies.readText(speakerPlanPath, 'utf8'),
      ) as unknown,
    );
    return createDubbingSpeakerTrack(sourceTrackRevision, plan);
  }

  private publish(
    request: AssetArtifactProduceRequest,
    phase: MediaDubbingProgressPhase,
    completedPhrases: number,
    totalPhrases: number,
    completedDurationMs: number,
    durationMs: number,
    readySuffixStartMs: number,
    preview?: {
      readonly audioPath: string;
    },
    speakerTrack?: DubbingSpeakerTrackV1,
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
        ...(speakerTrack ? { speakerTrack } : {}),
      }),
    );
  }
}

export const mediaDubbingProducerMetadata = Object.freeze({
  model: 'VoxCPM2',
  phrasePlannerVersion: DUBBING_PHRASE_PLANNER_VERSION,
  speakerPlannerVersion: DUBBING_SPEAKER_PLANNER_VERSION,
});
