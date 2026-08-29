import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExternalCommandRunnerApi } from '../../../main/external-libraries/external-command-runner';
import type { ExternalLibraryServiceApi } from '../../../main/external-libraries/external-library-service';
import { MEDIA_DUBBING_VOXCPM2_LIBRARY_ID } from './voxcpm2-definition';
import { VoxCpm2DubbingRuntimeResolver } from './voxcpm2-runtime';

const temporaryDirectories: string[] = [];

async function createRuntimeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lc-voxcpm2-runtime-'));
  temporaryDirectories.push(root);
  return root;
}

function externalLibraries(runtimeDirectory: string) {
  const requireRuntime = vi.fn(async (libraryId: string) => ({
    libraryId,
    runtimeDirectory,
  }));
  return {
    requireRuntime,
    service: { requireRuntime } as unknown as ExternalLibraryServiceApi,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('VoxCpm2DubbingRuntimeResolver', () => {
  it('checks the installed bundle without preparing the Python environment', async () => {
    const root = await createRuntimeRoot();
    const { service, requireRuntime } = externalLibraries(root);
    const run = vi.fn<ExternalCommandRunnerApi['run']>();
    const resolver = new VoxCpm2DubbingRuntimeResolver(service, {
      commandRunner: { run },
      platform: 'win32',
    });

    await resolver.requireInstalledBundle();

    expect(requireRuntime).toHaveBeenCalledWith(
      MEDIA_DUBBING_VOXCPM2_LIBRARY_ID,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('prepares one isolated runtime and keeps every cache under the component', async () => {
    const root = await createRuntimeRoot();
    const { service, requireRuntime } = externalLibraries(root);
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async (request) => {
      if (request.args[0] === 'venv') {
        const scripts = join(root, 'environment', 'Scripts');
        await mkdir(scripts, { recursive: true });
        await writeFile(join(scripts, 'python.exe'), 'mock');
      }
      return { stdout: '', stderr: '' };
    });
    const resolver = new VoxCpm2DubbingRuntimeResolver(service, {
      commandRunner: { run },
      platform: 'win32',
    });

    const runtime = await resolver.requireRuntime();

    expect(requireRuntime).toHaveBeenCalledWith(
      MEDIA_DUBBING_VOXCPM2_LIBRARY_ID,
    );
    expect(run).toHaveBeenCalledTimes(5);
    expect(run.mock.calls.map(([request]) => request.args[0])).toEqual([
      'venv',
      'pip',
      'pip',
      'pip',
      '-c',
    ]);
    expect(runtime.pythonPath).toBe(
      join(root, 'environment', 'Scripts', 'python.exe'),
    );
    expect(runtime.modelPath).toBe(join(root, 'models', 'VoxCPM2'));
    expect(runtime.workerCachePath).toBe(
      join(root, 'cache', 'model-sessions'),
    );
    const managedCacheKeys = [
      'UV_CACHE_DIR',
      'PIP_CACHE_DIR',
      'HF_HOME',
      'HF_HUB_CACHE',
      'TORCH_HOME',
      'TORCH_EXTENSIONS_DIR',
      'TORCHINDUCTOR_CACHE_DIR',
      'TRITON_CACHE_DIR',
      'CUDA_CACHE_PATH',
      'XDG_CACHE_HOME',
      'NUMBA_CACHE_DIR',
      'PYTHONPYCACHEPREFIX',
    ] as const;
    for (const key of managedCacheKeys) {
      expect(runtime.environment[key]?.toLowerCase()).toContain(
        root.toLowerCase(),
      );
    }
  });

  it('reuses a matching managed environment without running installation', async () => {
    const root = await createRuntimeRoot();
    const environment = join(root, 'environment');
    await mkdir(join(environment, 'Scripts'), { recursive: true });
    await writeFile(join(environment, 'Scripts', 'python.exe'), 'mock');
    await writeFile(
      join(environment, 'learning-companion-runtime.json'),
      JSON.stringify({ version: 1 }),
    );
    const { service } = externalLibraries(root);
    const run = vi.fn<ExternalCommandRunnerApi['run']>();

    await new VoxCpm2DubbingRuntimeResolver(service, {
      commandRunner: { run },
      platform: 'win32',
    }).requireRuntime();

    expect(run).not.toHaveBeenCalled();
  });

  it('shares one warm model across Workbench consumers until the last release', async () => {
    const root = await createRuntimeRoot();
    const environment = join(root, 'environment');
    await mkdir(join(environment, 'Scripts'), { recursive: true });
    await writeFile(join(environment, 'Scripts', 'python.exe'), 'mock');
    await writeFile(
      join(environment, 'learning-companion-runtime.json'),
      JSON.stringify({ version: 1 }),
    );
    const { service } = externalLibraries(root);
    let finishWorker: (() => void) | undefined;
    let requestPath = '';
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async (request) => {
      requestPath = request.args[request.args.indexOf('--request') + 1]!;
      const readyPath = request.args[request.args.indexOf('--ready') + 1]!;
      await writeFile(readyPath, '{"ready":true}\n');
      await new Promise<void>((resolvePromise) => {
        finishWorker = resolvePromise;
      });
      return { stdout: '', stderr: '' };
    });
    const resolver = new VoxCpm2DubbingRuntimeResolver(service, {
      commandRunner: { run },
      platform: 'win32',
    });

    await Promise.all([resolver.warmup(), resolver.warmup()]);
    expect(run).toHaveBeenCalledOnce();
    await resolver.releaseWarmup();

    const job = {
      referencePath: join(root, 'reference.wav'),
      phrasesPath: join(root, 'phrases.json'),
      outputDirectory: join(root, 'voice'),
      progressPath: join(root, 'progress.json'),
      backgroundPath: join(root, 'background.wav'),
      previewPath: join(root, 'preview.wav'),
      ffmpegPath: join(root, 'ffmpeg.exe'),
      durationMs: 12_000,
    };
    const running = resolver.runVoiceJob(
      job,
      new AbortController().signal,
    );
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(requestPath, 'utf8'))).toEqual(job);
    });
    finishWorker?.();
    await running;

    expect(run).toHaveBeenCalledOnce();
    await expect(access(requestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await resolver.releaseWarmup();
  });

  it('stops an unfinished warmup once without reporting a failure', async () => {
    const root = await createRuntimeRoot();
    const environment = join(root, 'environment');
    await mkdir(join(environment, 'Scripts'), { recursive: true });
    await writeFile(join(environment, 'Scripts', 'python.exe'), 'mock');
    await writeFile(
      join(environment, 'learning-companion-runtime.json'),
      JSON.stringify({ version: 1 }),
    );
    const { service } = externalLibraries(root);
    let sessionDirectory = '';
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async (request) => {
      sessionDirectory = dirname(request.args[0]!);
      await new Promise<void>((_resolvePromise, rejectPromise) => {
        const rejectAborted = () => rejectPromise(new Error('cancelled'));
        if (request.signal?.aborted) {
          rejectAborted();
        } else {
          request.signal?.addEventListener('abort', rejectAborted, {
            once: true,
          });
        }
      });
      return { stdout: '', stderr: '' };
    });
    const resolver = new VoxCpm2DubbingRuntimeResolver(service, {
      commandRunner: { run },
      platform: 'win32',
    });

    const warming = resolver.warmup();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await resolver.releaseWarmup();

    await expect(warming).resolves.toBeUndefined();
    await expect(access(sessionDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('resumes an incomplete environment without clearing downloaded packages', async () => {
    const root = await createRuntimeRoot();
    const scripts = join(root, 'environment', 'Scripts');
    await mkdir(scripts, { recursive: true });
    await writeFile(join(scripts, 'python.exe'), 'mock');
    const { service } = externalLibraries(root);
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async () => ({
      stdout: '',
      stderr: '',
    }));

    await new VoxCpm2DubbingRuntimeResolver(service, {
      commandRunner: { run },
      platform: 'win32',
    }).requireRuntime();

    expect(run.mock.calls.map(([request]) => request.args[0])).toEqual([
      'pip',
      'pip',
      'pip',
      '-c',
    ]);
    expect(
      run.mock.calls.some(([request]) => request.args.includes('--clear')),
    ).toBe(false);
    for (const [request] of run.mock.calls) {
      expect(request.env?.UV_CACHE_DIR).not.toContain(root);
      expect(request.env?.TEMP).toBe(request.env?.UV_CACHE_DIR);
    }
  });

  it('rejects unsupported platforms before asking for an installation', async () => {
    const root = await createRuntimeRoot();
    const { service, requireRuntime } = externalLibraries(root);
    const resolver = new VoxCpm2DubbingRuntimeResolver(service, {
      platform: 'darwin',
    });

    await expect(resolver.requireRuntime()).rejects.toMatchObject({
      code: 'FEATURE_NOT_SUPPORTED',
    });
    expect(requireRuntime).not.toHaveBeenCalled();
  });

  it('clears a failed preparation so the user can retry', async () => {
    const root = await createRuntimeRoot();
    const { service, requireRuntime } = externalLibraries(root);
    let failed = false;
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async (request) => {
      if (!failed) {
        failed = true;
        throw new Error('temporary setup failure');
      }
      if (request.args[0] === 'venv') {
        const scripts = join(root, 'environment', 'Scripts');
        await mkdir(scripts, { recursive: true });
        await writeFile(join(scripts, 'python.exe'), 'mock');
      }
      return { stdout: '', stderr: '' };
    });
    const resolver = new VoxCpm2DubbingRuntimeResolver(service, {
      commandRunner: { run },
      platform: 'win32',
    });

    await expect(resolver.requireRuntime()).rejects.toThrow(
      'temporary setup failure',
    );
    await expect(resolver.requireRuntime()).resolves.toBeDefined();
    expect(requireRuntime).toHaveBeenCalledTimes(2);
  });
});
