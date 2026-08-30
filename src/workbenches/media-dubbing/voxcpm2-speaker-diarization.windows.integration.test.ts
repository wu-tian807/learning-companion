import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ExternalCommandRunner } from '../../main/external-libraries/external-command-runner';
import { parseDubbingSpeakerSegments } from './dubbing-speaker-planner';
import { SPEAKER_DIARIZATION_WORKER_SOURCE } from './voxcpm2-worker-sources';

const integrationEnvironment = {
  python: process.env.LC_VOXCPM2_TEST_PYTHON,
  audio: process.env.LC_VOXCPM2_TEST_SPEAKER_AUDIO,
  segmentationModel:
    process.env.LC_VOXCPM2_TEST_SPEAKER_SEGMENTATION_MODEL,
  embeddingModel: process.env.LC_VOXCPM2_TEST_SPEAKER_EMBEDDING_MODEL,
};
const enabled =
  process.platform === 'win32' &&
  Object.values(integrationEnvironment).every(
    (value) => typeof value === 'string' && value.length > 0,
  );

describe.skipIf(!enabled)('speaker diarization Windows integration', () => {
  it(
    'runs the pinned sherpa-onnx models and returns stable time segments',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'lc-speaker-diarization-'));
      try {
        const workerPath = join(directory, 'diarize-speakers.py');
        const outputPath = join(directory, 'speaker-analysis.json');
        await writeFile(workerPath, SPEAKER_DIARIZATION_WORKER_SOURCE, 'utf8');
        await new ExternalCommandRunner().run({
          command: resolve(integrationEnvironment.python!),
          args: [
            workerPath,
            '--input',
            resolve(integrationEnvironment.audio!),
            '--segmentation-model',
            resolve(integrationEnvironment.segmentationModel!),
            '--embedding-model',
            resolve(integrationEnvironment.embeddingModel!),
            '--output',
            outputPath,
          ],
          cwd: directory,
          timeoutMs: 10 * 60 * 1_000,
        });
        const payload = JSON.parse(await readFile(outputPath, 'utf8')) as {
          readonly segments?: readonly {
            readonly end?: number;
          }[];
        };
        const durationMs = Math.ceil(
          Math.max(...(payload.segments ?? []).map(({ end }) => end ?? 0)) *
            1_000,
        );
        const segments = parseDubbingSpeakerSegments(payload, durationMs);

        expect(new Set(segments.map(({ speakerId }) => speakerId)).size).toBe(
          4,
        );
        expect(
          segments.every(
            (segment, index) =>
              index === 0 ||
              segment.startMs >= segments[index - 1]!.startMs,
          ),
        ).toBe(true);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    10 * 60 * 1_000,
  );
});
