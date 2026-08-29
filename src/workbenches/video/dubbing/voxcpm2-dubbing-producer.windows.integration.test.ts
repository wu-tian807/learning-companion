import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  AssetArtifactRequest,
  AssetArtifactServiceApi,
  ResolvedAssetArtifact,
} from '../../../main/artifacts/asset-artifact-service';
import { ExternalCommandRunner } from '../../../main/external-libraries/external-command-runner';
import type { MediaSubtitleRuntimeResolverApi } from '../../media-subtitles/external-libraries/media-subtitle-runtime';
import type { VoxCpm2DubbingRuntimeResolverApi } from './external-libraries/voxcpm2-runtime';
import {
  VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE,
  VideoDubbingProgressHub,
  VoxCpm2DubbingProducer,
  createVoxCpm2DubbingArtifactKey,
} from './voxcpm2-dubbing-producer';
import { VOXCPM2_DUBBING_WORKER_SOURCE } from './voxcpm2-worker-sources';

const integrationEnvironment = {
  video: process.env.LC_VOXCPM2_TEST_VIDEO,
  python: process.env.LC_VOXCPM2_TEST_PYTHON,
  model: process.env.LC_VOXCPM2_TEST_MODEL,
  separationModel: process.env.LC_VOXCPM2_TEST_SEPARATION_MODEL,
  ffmpeg: process.env.LC_VOXCPM2_TEST_FFMPEG,
  ffprobe: process.env.LC_VOXCPM2_TEST_FFPROBE,
};
const enabled =
  process.platform === 'win32' &&
  Object.values(integrationEnvironment).every(
    (value) => typeof value === 'string' && value.length > 0,
  );

describe.skipIf(!enabled)('VoxCPM2 dubbing Windows integration', () => {
  it(
    'separates a real soundtrack, clones in reverse order and creates playable AAC',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'lc-voxcpm2-real-'));
      try {
        const video = resolve(integrationEnvironment.video!);
        const producer = new VoxCpm2DubbingProducer(
          new VideoDubbingProgressHub(),
        );
        const request: AssetArtifactRequest = {
          assetId: 'video',
          producerId: producer.id,
          artifactKey: createVoxCpm2DubbingArtifactKey('zh-Hans'),
          workspacePath: directory,
          source: {
            assetId: 'video',
            mediaType: 'video/mp4',
            absolutePath: video,
            revision: 'real-test-revision',
          },
        };
        const artifacts: AssetArtifactServiceApi = {
          async getCached() {
            return undefined;
          },
          async getOrCreate(_request, signal) {
            const produced = await producer.produce(
              { ...request, stagingDirectory: directory },
              signal ?? new AbortController().signal,
            );
            return {
              absolutePath: produced.filePath,
              cacheHit: false,
              artifact: {
                assetId: 'video',
                producerId: producer.id,
                artifactKey: request.artifactKey,
                relativePath: 'artifacts/dubbed.m4a',
                mediaType: produced.mediaType,
                sourceRevision: request.source.revision,
                producerVersion: producer.version,
                artifactRevision: 'real-output-revision',
                updatedTime: Date.now(),
              },
            } satisfies ResolvedAssetArtifact;
          },
        };
        const subtitleRuntime = {
          async requireMediaDecoder() {
            return {
              ffmpegPath: resolve(integrationEnvironment.ffmpeg!),
              ffprobePath: resolve(integrationEnvironment.ffprobe!),
            };
          },
        } as unknown as MediaSubtitleRuntimeResolverApi;
        const dubbingRuntime: VoxCpm2DubbingRuntimeResolverApi = {
          async requireInstalledBundle() {},
          async requireRuntime() {
            return {
              pythonPath: resolve(integrationEnvironment.python!),
              modelPath: resolve(integrationEnvironment.model!),
              separationModelPath: resolve(
                integrationEnvironment.separationModel!,
              ),
              workerCachePath: join(directory, 'worker-cache'),
              environment: { ...process.env },
            };
          },
          async warmup() {},
          async releaseWarmup() {},
          async runVoiceJob(job, signal) {
            const workerPath = join(directory, 'voice-worker.py');
            const requestPath = join(directory, 'voice-request.json');
            const readyPath = join(directory, 'voice-ready.json');
            await Promise.all([
              writeFile(workerPath, VOXCPM2_DUBBING_WORKER_SOURCE, 'utf8'),
              writeFile(requestPath, `${JSON.stringify(job)}\n`, 'utf8'),
            ]);
            await new ExternalCommandRunner().run({
              command: resolve(integrationEnvironment.python!),
              args: [
                workerPath,
                '--model',
                resolve(integrationEnvironment.model!),
                '--request',
                requestPath,
                '--ready',
                readyPath,
              ],
              cwd: directory,
              env: { ...process.env },
              timeoutMs: 4 * 60 * 60 * 1_000,
              signal,
            });
          },
        };

        const output = await producer.materialize(
          artifacts,
          request,
          {
            version: 1,
            kind: 'subtitle-source',
            sourceRevision: 'video-source-revision',
            language: 'en',
            origin: 'asr',
            engine: {
              id: 'fixture',
              version: '1',
              model: 'fixture',
              backend: 'test',
            },
            generatedTime: 100,
            cues: [
              {
                id: 'cue-1',
                startMs: 0,
                endMs: 3_200,
                text: 'Reference speech one.',
                sourceCueIds: ['raw-1'],
              },
              {
                id: 'cue-2',
                startMs: 3_400,
                endMs: 6_400,
                text: 'Reference speech two.',
                sourceCueIds: ['raw-2'],
              },
              {
                id: 'cue-3',
                startMs: 6_600,
                endMs: 9_500,
                text: 'Reference speech three.',
                sourceCueIds: ['raw-3'],
              },
            ],
          },
          {
            version: 1,
            kind: 'subtitle-translation',
            sourceTrackRevision: 'source-artifact-revision',
            sourceLanguage: 'en',
            targetLanguage: 'zh-Hans',
            profile: 'quality',
            engine: {
              id: 'fixture',
              version: '1',
              model: 'fixture',
              backend: 'test',
            },
            generatedTime: 100,
            cues: [
              { sourceCueId: 'cue-1', text: '这是第一段测试配音。' },
              { sourceCueId: 'cue-2', text: '这是第二段测试配音。' },
              { sourceCueId: 'cue-3', text: '这是最后一段测试配音。' },
            ],
          },
          subtitleRuntime,
          dubbingRuntime,
        );

        expect(output.artifact.mediaType).toBe(
          VOXCPM2_DUBBING_ARTIFACT_MEDIA_TYPE,
        );
        await expect(access(output.absolutePath)).resolves.toBeUndefined();
        const probe = await new ExternalCommandRunner().run({
          command: resolve(integrationEnvironment.ffprobe!),
          args: [
            '-v',
            'error',
            '-select_streams',
            'a:0',
            '-show_entries',
            'stream=codec_name:format=duration',
            '-of',
            'json',
            output.absolutePath,
          ],
          timeoutMs: 60_000,
        });
        const media = JSON.parse(probe.stdout) as {
          readonly streams?: readonly { readonly codec_name?: unknown }[];
          readonly format?: { readonly duration?: unknown };
        };
        expect(media.streams?.[0]?.codec_name).toBe('aac');
        expect(Number(media.format?.duration)).toBeGreaterThan(9);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    20 * 60 * 1_000,
  );
});
