import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ExternalLibraryServiceApi } from '../../../../main/external-libraries/external-library-service';
import { ExternalCommandRunner } from '../../../../main/external-libraries/external-command-runner';
import { WRITABLE_AUDIO_NORMALIZER_SOURCE } from '../voxcpm2-worker-sources';
import { VoxCpm2DubbingRuntimeResolver } from './voxcpm2-runtime';

const runtimeRoot = process.env.LC_VOXCPM2_RUNTIME_ROOT;
const enabled =
  process.platform === 'win32' &&
  typeof runtimeRoot === 'string' &&
  runtimeRoot.length > 0;

function riffChunk(id: string, payload: Buffer): Buffer {
  const padding = payload.length % 2;
  const chunk = Buffer.alloc(8 + payload.length + padding);
  chunk.write(id, 0, 4, 'ascii');
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);
  return chunk;
}

function wavWithTextMetadata(): Buffer {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(1, 2);
  format.writeUInt32LE(8_000, 4);
  format.writeUInt32LE(16_000, 8);
  format.writeUInt16LE(2, 12);
  format.writeUInt16LE(16, 14);
  const info = riffChunk(
    'LIST',
    Buffer.concat([
      Buffer.from('INFO', 'ascii'),
      riffChunk('ISFT', Buffer.from('Lavf test encoder\0', 'ascii')),
    ]),
  );
  const body = Buffer.concat([
    Buffer.from('WAVE', 'ascii'),
    riffChunk('fmt ', format),
    info,
    riffChunk('data', Buffer.alloc(160)),
  ]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

describe.skipIf(!enabled)('VoxCPM2 runtime Windows integration', () => {
  it(
    'resumes the installed component and validates the real CUDA runtime',
    async () => {
      const root = resolve(runtimeRoot!);
      const externalLibraries = {
        async requireRuntime(libraryId: string) {
          return { libraryId, runtimeDirectory: root };
        },
      } as unknown as ExternalLibraryServiceApi;

      const runtime = await new VoxCpm2DubbingRuntimeResolver(
        externalLibraries,
      ).requireRuntime();

      await expect(access(runtime.pythonPath)).resolves.toBeUndefined();
      await expect(access(runtime.modelPath)).resolves.toBeUndefined();
      await expect(access(runtime.separationModelPath)).resolves.toBeUndefined();
      const marker = JSON.parse(
        await readFile(
          join(root, 'environment', 'learning-companion-runtime.json'),
          'utf8',
        ),
      ) as { readonly version?: unknown };
      expect(marker.version).toBe(1);

      const validation = await new ExternalCommandRunner().run({
        command: runtime.pythonPath,
        args: [
          '-c',
          [
            'import torch, torchaudio, sherpa_onnx, soundfile',
            'from voxcpm import VoxCPM',
            "assert torch.cuda.is_available(), 'NVIDIA CUDA is unavailable'",
            "print(torch.__version__ + '|' + torch.cuda.get_device_name(0))",
          ].join('; '),
        ],
        cwd: root,
        env: runtime.environment,
        timeoutMs: 5 * 60 * 1_000,
      });
      expect(validation.stdout).toContain('2.8.0+cu128');
    },
    2 * 60 * 60 * 1_000,
  );

  it('normalizes a legacy FFmpeg WAV before resuming writable output', async () => {
    const root = resolve(runtimeRoot!);
    const externalLibraries = {
      async requireRuntime(libraryId: string) {
        return { libraryId, runtimeDirectory: root };
      },
    } as unknown as ExternalLibraryServiceApi;
    const runtime = await new VoxCpm2DubbingRuntimeResolver(
      externalLibraries,
    ).requireRuntime();
    const directory = await mkdtemp(join(tmpdir(), 'lc-writable-wav-'));
    try {
      const audioPath = join(directory, 'legacy.wav');
      const scriptPath = join(directory, 'normalize.py');
      await Promise.all([
        writeFile(audioPath, wavWithTextMetadata()),
        writeFile(
          scriptPath,
          [
            'from pathlib import Path',
            'import sys',
            'import soundfile as sf',
            WRITABLE_AUDIO_NORMALIZER_SOURCE,
            'path = Path(sys.argv[1])',
            'before, sample_rate = sf.read(path, dtype="float32", always_2d=True)',
            'try:',
            '    with sf.SoundFile(path, mode="r+"):',
            '        pass',
            'except sf.LibsndfileError:',
            '    pass',
            'else:',
            '    raise AssertionError("fixture must reproduce the writable metadata failure")',
            'ensure_writable_audio(path)',
            'with sf.SoundFile(path, mode="r+") as audio:',
            '    assert audio.samplerate == sample_rate',
            'after, _ = sf.read(path, dtype="float32", always_2d=True)',
            'assert before.shape == after.shape',
            'assert (before == after).all()',
            'print("metadata-normalized")',
            '',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const result = await new ExternalCommandRunner().run({
        command: runtime.pythonPath,
        args: [scriptPath, audioPath],
        cwd: directory,
        env: runtime.environment,
        timeoutMs: 60_000,
      });

      expect(result.stdout).toContain('metadata-normalized');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
