import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import writeFileAtomic from 'write-file-atomic';

import { AppError } from '../../../main/errors/app-error';
import {
  ExternalCommandRunner,
  type ExternalCommandRunnerApi,
} from '../../../main/external-libraries/external-command-runner';
import type { ExternalLibraryServiceApi } from '../../../main/external-libraries/external-library-service';
import { VOXCPM2_DUBBING_WORKER_SOURCE } from '../voxcpm2-worker-sources';
import { MEDIA_DUBBING_VOXCPM2_LIBRARY_ID } from './voxcpm2-definition';

const RUNTIME_ENVIRONMENT_VERSION = 1;
const SETUP_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
const MODEL_SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1_000;
const MODEL_READY_POLL_MS = 100;

export interface VoxCpm2DubbingRuntime {
  readonly pythonPath: string;
  readonly modelPath: string;
  readonly separationModelPath: string;
  readonly workerCachePath: string;
  readonly environment: NodeJS.ProcessEnv;
}

export interface VoxCpm2VoiceJob {
  readonly referencePath: string;
  readonly phrasesPath: string;
  readonly outputDirectory: string;
  readonly progressPath: string;
  readonly backgroundPath: string;
  readonly previewPath: string;
  readonly ffmpegPath: string;
  readonly durationMs: number;
}

export interface VoxCpm2DubbingRuntimeResolverApi {
  requireInstalledBundle(): Promise<void>;
  requireRuntime(): Promise<VoxCpm2DubbingRuntime>;
  warmup(): Promise<void>;
  releaseWarmup(): Promise<void>;
  runVoiceJob(job: VoxCpm2VoiceJob, signal: AbortSignal): Promise<void>;
}

export interface VoxCpm2DubbingRuntimeResolverDependencies {
  readonly commandRunner: ExternalCommandRunnerApi;
  readonly platform: NodeJS.Platform;
  readonly readText: typeof readFile;
  readonly writeText: typeof writeFile;
  readonly makeDirectory: typeof mkdir;
  readonly fileAccess: typeof access;
}

interface ModelSession {
  readonly directory: string;
  readonly requestPath: string;
  readonly readyPath: string;
  readonly controller: AbortController;
  readonly completion: Promise<unknown>;
  readonly ready: Promise<void>;
  claimed: boolean;
  disposal?: Promise<void>;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function runtimeEnvironment(
  root: string,
  pythonPath: string,
): NodeJS.ProcessEnv {
  const cacheRoot = join(root, 'cache');
  const torchLibraries = join(
    dirname(dirname(pythonPath)),
    'Lib',
    'site-packages',
    'torch',
    'lib',
  );
  return {
    ...process.env,
    PATH: [torchLibraries, process.env.PATH].filter(Boolean).join(delimiter),
    UV_CACHE_DIR: join(cacheRoot, 'uv'),
    UV_PYTHON_INSTALL_DIR: join(root, 'managed-python'),
    PIP_CACHE_DIR: join(cacheRoot, 'pip'),
    HF_HOME: join(cacheRoot, 'huggingface'),
    HF_HUB_CACHE: join(cacheRoot, 'huggingface', 'hub'),
    TORCH_HOME: join(cacheRoot, 'torch'),
    TORCH_EXTENSIONS_DIR: join(cacheRoot, 'torch-extensions'),
    TORCHINDUCTOR_CACHE_DIR: join(cacheRoot, 'torch-inductor'),
    TRITON_CACHE_DIR: join(cacheRoot, 'triton'),
    CUDA_CACHE_PATH: join(cacheRoot, 'cuda'),
    XDG_CACHE_HOME: join(cacheRoot, 'xdg'),
    NUMBA_CACHE_DIR: join(cacheRoot, 'numba'),
    PYTHONPYCACHEPREFIX: join(cacheRoot, 'pycache'),
    HF_HUB_DISABLE_TELEMETRY: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    WANDB_MODE: 'disabled',
    DO_NOT_TRACK: '1',
  };
}

async function exists(
  fileAccess: typeof access,
  path: string,
): Promise<boolean> {
  try {
    await fileAccess(path);
    return true;
  } catch {
    return false;
  }
}

export class VoxCpm2DubbingRuntimeResolver implements VoxCpm2DubbingRuntimeResolverApi {
  private readonly dependencies: VoxCpm2DubbingRuntimeResolverDependencies;
  private preparation?: Promise<VoxCpm2DubbingRuntime>;
  private modelSession?: ModelSession;
  private modelSessionPreparation?: Promise<ModelSession>;
  private warmupRetainCount = 0;
  private voiceQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly externalLibraries: ExternalLibraryServiceApi,
    dependencies: Partial<VoxCpm2DubbingRuntimeResolverDependencies> = {},
  ) {
    this.dependencies = {
      commandRunner: dependencies.commandRunner ?? new ExternalCommandRunner(),
      platform: dependencies.platform ?? process.platform,
      readText: dependencies.readText ?? readFile,
      writeText: dependencies.writeText ?? writeFile,
      makeDirectory: dependencies.makeDirectory ?? mkdir,
      fileAccess: dependencies.fileAccess ?? access,
    };
  }

  async requireRuntime(): Promise<VoxCpm2DubbingRuntime> {
    this.assertSupportedPlatform();
    if (!this.preparation) {
      this.preparation = this.prepare().catch((error: unknown) => {
        this.preparation = undefined;
        throw error;
      });
    }
    return this.preparation;
  }

  async requireInstalledBundle(): Promise<void> {
    this.assertSupportedPlatform();
    await this.externalLibraries.requireRuntime(
      MEDIA_DUBBING_VOXCPM2_LIBRARY_ID,
    );
  }

  async warmup(): Promise<void> {
    this.warmupRetainCount += 1;
    try {
      await this.warmModel();
    } catch (error) {
      this.warmupRetainCount = Math.max(0, this.warmupRetainCount - 1);
      throw error;
    }
  }

  private async warmModel(): Promise<void> {
    const runtime = await this.requireRuntime();
    const session = await this.requireModelSession(runtime);
    try {
      await session.ready;
    } catch (error) {
      await this.discardModelSession(session, true);
      if (this.warmupRetainCount === 0 && session.controller.signal.aborted) {
        return;
      }
      throw error;
    }
  }

  async releaseWarmup(): Promise<void> {
    this.warmupRetainCount = Math.max(0, this.warmupRetainCount - 1);
    let session = this.modelSession;
    if (
      this.warmupRetainCount === 0 &&
      !session &&
      this.modelSessionPreparation
    ) {
      session = await this.modelSessionPreparation.catch(() => undefined);
    }
    if (this.warmupRetainCount === 0 && session && !session.claimed) {
      await this.discardModelSession(session, true);
    }
  }

  runVoiceJob(job: VoxCpm2VoiceJob, signal: AbortSignal): Promise<void> {
    const queued = this.voiceQueue.then(() => this.executeVoiceJob(job, signal));
    this.voiceQueue = queued.catch(() => undefined);
    return queued;
  }

  private assertSupportedPlatform(): void {
    if (this.dependencies.platform !== 'win32') {
      throw new AppError('FEATURE_NOT_SUPPORTED');
    }
  }

  private async prepare(): Promise<VoxCpm2DubbingRuntime> {
    const installed = await this.externalLibraries.requireRuntime(
      MEDIA_DUBBING_VOXCPM2_LIBRARY_ID,
    );
    const root = installed.runtimeDirectory;
    const uvPath = join(root, 'bootstrap', 'uv', 'uv.exe');
    const environmentRoot = join(root, 'environment');
    const pythonPath = join(environmentRoot, 'Scripts', 'python.exe');
    const markerPath = join(environmentRoot, 'learning-companion-runtime.json');
    const modelPath = join(root, 'models', 'VoxCPM2');
    const separationModelPath = join(
      root,
      'models',
      'source-separation',
      'UVR-MDX-NET-Inst_HQ_4.onnx',
    );
    const workerCachePath = join(root, 'cache', 'model-sessions');
    const environment = runtimeEnvironment(root, pythonPath);
    const ready = await this.isReady(markerPath, pythonPath);

    if (!ready) {
      await this.dependencies.makeDirectory(join(root, 'cache'), {
        recursive: true,
      });
      const setupCache = await mkdtemp(
        join(tmpdir(), 'lc-voxcpm2-setup-'),
      );
      const setupEnvironment = {
        ...environment,
        UV_CACHE_DIR: setupCache,
        PIP_CACHE_DIR: setupCache,
        TEMP: setupCache,
        TMP: setupCache,
      };
      try {
        if (!(await exists(this.dependencies.fileAccess, pythonPath))) {
          await this.dependencies.commandRunner.run({
            command: uvPath,
            args: [
              'venv',
              environmentRoot,
              '--python',
              '3.12',
              '--python-preference',
              'only-managed',
              '--clear',
            ],
            cwd: root,
            env: setupEnvironment,
            timeoutMs: SETUP_TIMEOUT_MS,
          });
        }
        await this.dependencies.commandRunner.run({
          command: uvPath,
          args: [
            'pip',
            'install',
            '--python',
            pythonPath,
            'torch==2.8.0+cu128',
            'torchaudio==2.8.0+cu128',
            '--index-url',
            'https://download.pytorch.org/whl/cu128',
          ],
          cwd: root,
          env: setupEnvironment,
          timeoutMs: SETUP_TIMEOUT_MS,
        });
        await this.dependencies.commandRunner.run({
          command: uvPath,
          args: [
            'pip',
            'install',
            '--python',
            pythonPath,
            'voxcpm==2.0.3',
            'torchcodec==0.7.0',
            'transformers==4.57.6',
            'huggingface-hub==0.36.0',
            'pydantic==2.13.4',
            'datasets<4',
            'sherpa-onnx==1.13.6',
            'soundfile==0.13.1',
          ],
          cwd: root,
          env: setupEnvironment,
          timeoutMs: SETUP_TIMEOUT_MS,
        });
        await this.dependencies.commandRunner.run({
          command: uvPath,
          args: [
            'pip',
            'install',
            '--python',
            pythonPath,
            '--reinstall',
            '--no-deps',
            'sherpa-onnx==1.13.6+cuda12.cudnn9',
            '--find-links',
            'https://k2-fsa.github.io/sherpa/onnx/cuda.html',
          ],
          cwd: root,
          env: setupEnvironment,
          timeoutMs: SETUP_TIMEOUT_MS,
        });
        await this.dependencies.commandRunner.run({
          command: pythonPath,
          args: [
            '-c',
            [
              'import torch, torchaudio, sherpa_onnx, soundfile',
              'from voxcpm import VoxCPM',
              "assert torch.cuda.is_available(), 'NVIDIA CUDA is unavailable'",
            ].join('; '),
          ],
          cwd: root,
          env: setupEnvironment,
          timeoutMs: 5 * 60 * 1_000,
        });
      } finally {
        await rm(setupCache, { recursive: true, force: true });
      }
      await this.dependencies.writeText(
        markerPath,
        `${JSON.stringify({ version: RUNTIME_ENVIRONMENT_VERSION })}\n`,
        'utf8',
      );
    }

    return Object.freeze({
      pythonPath,
      modelPath,
      separationModelPath,
      workerCachePath,
      environment: Object.freeze({ ...environment }),
    });
  }

  private async executeVoiceJob(
    job: VoxCpm2VoiceJob,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const runtime = await this.requireRuntime();
    const session = await this.requireModelSession(runtime);
    session.claimed = true;
    const abortSession = () => session.controller.abort();
    signal.addEventListener('abort', abortSession, { once: true });
    let failed = false;
    try {
      signal.throwIfAborted();
      await session.ready;
      signal.throwIfAborted();
      await writeFileAtomic(
        session.requestPath,
        `${JSON.stringify(job)}\n`,
        { encoding: 'utf8' },
      );
      await session.completion;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      signal.removeEventListener('abort', abortSession);
      await this.discardModelSession(session, true);
      if (failed && this.warmupRetainCount > 0) {
        void this.warmModel().catch(() => undefined);
      }
    }
  }

  private async requireModelSession(
    runtime: VoxCpm2DubbingRuntime,
  ): Promise<ModelSession> {
    if (this.modelSession) return this.modelSession;
    if (!this.modelSessionPreparation) {
      this.modelSessionPreparation = this.createModelSession(runtime).finally(
        () => {
          this.modelSessionPreparation = undefined;
        },
      );
    }
    return this.modelSessionPreparation;
  }

  private async createModelSession(
    runtime: VoxCpm2DubbingRuntime,
  ): Promise<ModelSession> {
    await this.dependencies.makeDirectory(runtime.workerCachePath, {
      recursive: true,
    });
    const directory = await mkdtemp(join(runtime.workerCachePath, 'session-'));
    const workerPath = join(directory, 'worker.py');
    const requestPath = join(directory, 'request.json');
    const readyPath = join(directory, 'ready.json');
    await this.dependencies.writeText(
      workerPath,
      VOXCPM2_DUBBING_WORKER_SOURCE,
      'utf8',
    );
    const controller = new AbortController();
    const completion = this.dependencies.commandRunner.run({
      command: runtime.pythonPath,
      args: [
        workerPath,
        '--model',
        runtime.modelPath,
        '--request',
        requestPath,
        '--ready',
        readyPath,
      ],
      cwd: directory,
      env: runtime.environment,
      timeoutMs: MODEL_SESSION_TIMEOUT_MS,
      signal: controller.signal,
    });
    void completion.catch(() => undefined);
    const session: ModelSession = {
      directory,
      requestPath,
      readyPath,
      controller,
      completion,
      ready: this.waitForModelReady(readyPath, completion),
      claimed: false,
    };
    this.modelSession = session;
    return session;
  }

  private async waitForModelReady(
    readyPath: string,
    completion: Promise<unknown>,
  ): Promise<void> {
    while (!(await exists(this.dependencies.fileAccess, readyPath))) {
      const state = await Promise.race([
        completion.then(
          () => 'stopped' as const,
          (error: unknown) => Promise.reject(error),
        ),
        delay(MODEL_READY_POLL_MS).then(() => 'poll' as const),
      ]);
      if (state === 'stopped') {
        throw new AppError('MEDIA_DUBBING_FAILED', {
          cause: new Error('VoxCPM2 model worker stopped before warmup'),
        });
      }
    }
  }

  private async discardModelSession(
    session: ModelSession,
    abort: boolean,
  ): Promise<void> {
    if (!session.disposal) {
      session.disposal = (async () => {
        if (this.modelSession === session) this.modelSession = undefined;
        if (abort) session.controller.abort();
        await session.completion.catch(() => undefined);
        await rm(session.directory, {
          recursive: true,
          force: true,
          maxRetries: 8,
          retryDelay: 100,
        });
      })();
    } else if (abort) {
      session.controller.abort();
    }
    await session.disposal;
  }

  private async isReady(
    markerPath: string,
    pythonPath: string,
  ): Promise<boolean> {
    if (!(await exists(this.dependencies.fileAccess, pythonPath))) return false;
    try {
      const parsed = JSON.parse(
        await this.dependencies.readText(markerPath, 'utf8'),
      ) as { readonly version?: unknown };
      return parsed.version === RUNTIME_ENVIRONMENT_VERSION;
    } catch {
      return false;
    }
  }
}
