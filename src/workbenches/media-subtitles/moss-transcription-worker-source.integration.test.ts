import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MOSS_TRANSCRIPTION_WORKER_SOURCE } from './moss-transcription-worker-source';

const runIntegration = process.env.RUN_MOSS_WORKER_INTEGRATION === '1';
const integrationDescribe = runIntegration ? describe : describe.skip;

async function runWorker(
  pythonPath: string,
  args: readonly string[],
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(pythonPath, args, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`MOSS worker exited with ${code}: ${stderr}`));
    });
  });
}

integrationDescribe('MOSS transcription worker', () => {
  it(
    'emits overlapping speaker-aware cues from real PCM',
    async () => {
      const pythonPath = process.env.MOSS_INTEGRATION_PYTHON;
      const modelPath = process.env.MOSS_INTEGRATION_MODEL;
      const inputPath = process.env.MOSS_INTEGRATION_PCM;
      const backend = process.env.MOSS_INTEGRATION_BACKEND ?? 'cuda';
      if (!pythonPath || !modelPath || !inputPath) {
        throw new Error(
          'MOSS_INTEGRATION_PYTHON, MOSS_INTEGRATION_MODEL and MOSS_INTEGRATION_PCM are required',
        );
      }
      if (backend !== 'cuda' && backend !== 'metal') {
        throw new Error('MOSS_INTEGRATION_BACKEND must be cuda or metal');
      }

      const directory = await mkdtemp(join(tmpdir(), 'lc-moss-worker-'));
      try {
        const workerPath = join(directory, 'worker.py');
        const outputPath = join(directory, 'result.json');
        await writeFile(workerPath, MOSS_TRANSCRIPTION_WORKER_SOURCE, 'utf8');
        await runWorker(resolve(pythonPath), [
          workerPath,
          '--model',
          resolve(modelPath),
          '--input',
          resolve(inputPath),
          '--output',
          outputPath,
          '--backend',
          backend,
          '--threads',
          '8',
        ]);

        const result = JSON.parse(
          await readFile(outputPath, 'utf8'),
        ) as {
          readonly cues: readonly {
            readonly startMs: number;
            readonly endMs: number;
            readonly speakerId: string;
          }[];
          readonly speakerSegments: readonly unknown[];
        };

        expect(result.cues.length).toBeGreaterThan(0);
        expect(result.speakerSegments).toHaveLength(result.cues.length);
        expect(
          new Set(result.cues.map((cue) => cue.speakerId)).size,
        ).toBeGreaterThanOrEqual(2);
        expect(
          result.cues.some((cue, index) =>
            result.cues.some(
              (other, otherIndex) =>
                otherIndex > index &&
                other.speakerId !== cue.speakerId &&
                other.startMs < cue.endMs &&
                other.endMs > cue.startMs,
            ),
          ),
        ).toBe(true);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    10 * 60_000,
  );
});
