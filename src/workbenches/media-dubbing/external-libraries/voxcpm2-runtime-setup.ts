import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, delimiter, dirname, join } from 'node:path';

import { AppError } from '../../../main/errors/app-error';
import {
  ExternalCommandRunner,
  type ExternalCommandRunnerApi,
} from '../../../main/external-libraries/external-command-runner';
import type { ExternalLibraryRuntimeSetup } from '../../../main/external-libraries/external-library-runtime-setup';
import type { ExternalLibraryProgress } from '../../../shared/external-libraries';
import { MEDIA_DUBBING_VOXCPM2_LIBRARY_ID } from './voxcpm2-definition';

export const VOXCPM2_RUNTIME_ENVIRONMENT_VERSION = 2;
export const VOXCPM2_RUNTIME_SETUP_EXPECTED_BYTES = 13_000_000_000;
const SETUP_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
const SETUP_PROGRESS_POLL_INTERVAL_MS = 5_000;
const PYTORCH_CUDA_INDEX_URL =
  'https://mirrors.aliyun.com/pytorch-wheels/cu128';
const MANAGED_PYTHON_DIRECTORY =
  /^cpython-3\.12\.\d+-windows-x86_64-none$/u;

interface VoxCpm2RuntimeSetupDependencies {
  readonly commandRunner: ExternalCommandRunnerApi;
  readonly platform: NodeJS.Platform;
  readonly readText: typeof readFile;
  readonly writeText: typeof writeFile;
  readonly makeDirectory: typeof mkdir;
  readonly fileAccess: typeof access;
  readonly measureDirectories: (
    paths: readonly string[],
  ) => Promise<number>;
  readonly progressPollIntervalMs: number;
}

export interface VoxCpm2ManagedEnvironment {
  readonly pythonPath: string;
  readonly environment: NodeJS.ProcessEnv;
}

async function pathByteLength(path: string): Promise<number> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === 'ENOENT') {
      return 0;
    }
    throw error;
  }

  if (stats.isSymbolicLink()) return 0;
  if (stats.isFile()) return stats.size;
  if (!stats.isDirectory()) return 0;

  const sizes = await Promise.all(
    (await readdir(path)).map((entry) =>
      pathByteLength(join(path, entry)),
    ),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

async function measureDirectories(
  paths: readonly string[],
): Promise<number> {
  const sizes = await Promise.all(paths.map(pathByteLength));
  return sizes.reduce((total, size) => total + size, 0);
}

function runtimePaths(root: string) {
  const environmentRoot = join(root, 'environment');
  return Object.freeze({
    environmentRoot,
    pythonPath: join(environmentRoot, 'Scripts', 'python.exe'),
    configurationPath: join(environmentRoot, 'pyvenv.cfg'),
    markerPath: join(
      environmentRoot,
      'learning-companion-runtime.json',
    ),
  });
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

async function resolveManagedPythonPath(
  root: string,
  fileAccess: typeof access,
  readText: typeof readFile,
): Promise<string> {
  const { configurationPath } = runtimePaths(root);
  const home = (await readText(configurationPath, 'utf8'))
    .split(/\r?\n/u)
    .find((line) => line.startsWith('home = '))
    ?.slice('home = '.length)
    .trim();
  const directoryName = home ? basename(home) : '';
  if (!MANAGED_PYTHON_DIRECTORY.test(directoryName)) {
    throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
  }
  const managedPythonPath = join(
    root,
    'managed-python',
    directoryName,
    'python.exe',
  );
  if (!(await exists(fileAccess, managedPythonPath))) {
    throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
  }
  return managedPythonPath;
}

export function resolveVoxCpm2ManagedEnvironment(
  root: string,
): VoxCpm2ManagedEnvironment {
  const { pythonPath } = runtimePaths(root);
  return Object.freeze({
    pythonPath,
    environment: Object.freeze({
      ...runtimeEnvironment(root, pythonPath),
    }),
  });
}

export async function isVoxCpm2RuntimeReady(
  root: string,
  fileAccess: typeof access = access,
  readText: typeof readFile = readFile,
): Promise<boolean> {
  const { markerPath, pythonPath } = runtimePaths(root);
  if (!(await exists(fileAccess, pythonPath))) return false;
  try {
    const marker = JSON.parse(await readText(markerPath, 'utf8')) as {
      readonly version?: unknown;
    };
    return marker.version === VOXCPM2_RUNTIME_ENVIRONMENT_VERSION;
  } catch {
    return false;
  }
}

export class VoxCpm2RuntimeSetup implements ExternalLibraryRuntimeSetup {
  readonly libraryId = MEDIA_DUBBING_VOXCPM2_LIBRARY_ID;
  private readonly dependencies: VoxCpm2RuntimeSetupDependencies;

  constructor(
    dependencies: Partial<VoxCpm2RuntimeSetupDependencies> = {},
  ) {
    this.dependencies = {
      commandRunner: dependencies.commandRunner ?? new ExternalCommandRunner(),
      platform: dependencies.platform ?? process.platform,
      readText: dependencies.readText ?? readFile,
      writeText: dependencies.writeText ?? writeFile,
      makeDirectory: dependencies.makeDirectory ?? mkdir,
      fileAccess: dependencies.fileAccess ?? access,
      measureDirectories:
        dependencies.measureDirectories ?? measureDirectories,
      progressPollIntervalMs:
        dependencies.progressPollIntervalMs ??
        SETUP_PROGRESS_POLL_INTERVAL_MS,
    };
  }

  readonly expectedSetupBytes =
    VOXCPM2_RUNTIME_SETUP_EXPECTED_BYTES;

  isReady(runtimeDirectory: string): Promise<boolean> {
    return isVoxCpm2RuntimeReady(
      runtimeDirectory,
      this.dependencies.fileAccess,
      this.dependencies.readText,
    );
  }

  async prepare(
    runtimeDirectory: string,
    setupCacheDirectory: string,
    signal: AbortSignal,
    reportStatus: (
      statusDetail: string,
      progress?: ExternalLibraryProgress,
    ) => void,
  ): Promise<void> {
    if (this.dependencies.platform !== 'win32') {
      throw new AppError('FEATURE_NOT_SUPPORTED');
    }
    signal.throwIfAborted();
    if (await this.isReady(runtimeDirectory)) return;

    const { environmentRoot, markerPath, pythonPath } =
      runtimePaths(runtimeDirectory);
    const uvPath = join(
      runtimeDirectory,
      'bootstrap',
      'uv',
      'uv.exe',
    );
    await this.dependencies.makeDirectory(
      join(runtimeDirectory, 'cache'),
      { recursive: true },
    );
    await this.dependencies.makeDirectory(setupCacheDirectory, {
      recursive: true,
    });
    const setupTemporaryDirectory = join(
      runtimeDirectory,
      'cache',
      'setup-temp',
    );
    await this.dependencies.makeDirectory(setupTemporaryDirectory, {
      recursive: true,
    });
    const environment = {
      ...runtimeEnvironment(runtimeDirectory, pythonPath),
      UV_CACHE_DIR: join(setupCacheDirectory, 'uv'),
      PIP_CACHE_DIR: join(setupCacheDirectory, 'pip'),
      TEMP: setupTemporaryDirectory,
      TMP: setupTemporaryDirectory,
    };
    const measuredPaths = [
      environmentRoot,
      join(runtimeDirectory, 'managed-python'),
      setupCacheDirectory,
      setupTemporaryDirectory,
    ] as const;
    let currentStatusDetail = '正在准备 Python 运行环境';
    let maximumMeasuredBytes = 0;
    let activeMeasurement: Promise<void> | undefined;
    const currentProgress = (): ExternalLibraryProgress => ({
      completedBytes: Math.min(
        maximumMeasuredBytes,
        this.expectedSetupBytes - 1,
      ),
      totalBytes: this.expectedSetupBytes,
    });
    const sampleProgress = (): Promise<void> => {
      if (activeMeasurement) return activeMeasurement;
      const measurement = this.dependencies
        .measureDirectories(measuredPaths)
        .then((measuredBytes) => {
          if (Number.isSafeInteger(measuredBytes) && measuredBytes >= 0) {
            maximumMeasuredBytes = Math.max(
              maximumMeasuredBytes,
              measuredBytes,
            );
          }
          reportStatus(currentStatusDetail, currentProgress());
        })
        .catch(() => undefined)
        .finally(() => {
          if (activeMeasurement === measurement) {
            activeMeasurement = undefined;
          }
        });
      activeMeasurement = measurement;
      return measurement;
    };
    const updateStatus = async (statusDetail: string) => {
      currentStatusDetail = statusDetail;
      reportStatus(statusDetail, currentProgress());
      await sampleProgress();
    };

    await rm(markerPath, { force: true });
    const progressTimer = setInterval(() => {
      void sampleProgress();
    }, this.dependencies.progressPollIntervalMs);

    try {
      await updateStatus('正在准备 Python 运行环境');
      await this.run(uvPath, runtimeDirectory, environment, signal, [
        'venv',
        environmentRoot,
        '--python',
        '3.12',
        '--python-preference',
        'only-managed',
        '--clear',
      ]);
      await sampleProgress();
      await updateStatus(
        '正在下载并安装 PyTorch/CUDA 运行环境（按已写入文件估算）',
      );
      await this.run(uvPath, runtimeDirectory, environment, signal, [
        'pip',
        'install',
        '--python',
        pythonPath,
        'torch==2.8.0+cu128',
        'torchaudio==2.8.0+cu128',
        '--index-url',
        PYTORCH_CUDA_INDEX_URL,
      ]);
      await sampleProgress();
      await updateStatus('正在安装 VoxCPM2 配音运行依赖');
      await this.run(uvPath, runtimeDirectory, environment, signal, [
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
      ]);
      await sampleProgress();
      await updateStatus('正在安装 GPU 人声处理运行依赖');
      await this.run(uvPath, runtimeDirectory, environment, signal, [
        'pip',
        'install',
        '--python',
        pythonPath,
        '--reinstall',
        '--no-deps',
        'sherpa-onnx==1.13.6+cuda12.cudnn9',
        '--find-links',
        'https://k2-fsa.github.io/sherpa/onnx/cuda.html',
      ]);
      await sampleProgress();
      await updateStatus('正在验证 NVIDIA GPU 配音环境');
      await this.verifyRuntime(
        runtimeDirectory,
        pythonPath,
        environment,
        signal,
      );
      await sampleProgress();
    } finally {
      clearInterval(progressTimer);
      await activeMeasurement;
      await rm(setupTemporaryDirectory, {
        recursive: true,
        force: true,
      });
    }

    signal.throwIfAborted();
  }

  async finalizeInstallation(
    runtimeDirectory: string,
    signal: AbortSignal,
    reportStatus: (
      statusDetail: string,
      progress?: ExternalLibraryProgress,
    ) => void,
  ): Promise<void> {
    if (this.dependencies.platform !== 'win32') {
      throw new AppError('FEATURE_NOT_SUPPORTED');
    }
    signal.throwIfAborted();

    const { environmentRoot, markerPath, pythonPath } =
      runtimePaths(runtimeDirectory);
    await rm(markerPath, { force: true });
    const managedPythonPath = await resolveManagedPythonPath(
      runtimeDirectory,
      this.dependencies.fileAccess,
      this.dependencies.readText,
    );
    const uvPath = join(
      runtimeDirectory,
      'bootstrap',
      'uv',
      'uv.exe',
    );
    const environment = runtimeEnvironment(runtimeDirectory, pythonPath);

    reportStatus('正在完成配音运行环境配置');
    await this.run(uvPath, runtimeDirectory, environment, signal, [
      'venv',
      environmentRoot,
      '--python',
      managedPythonPath,
      '--python-preference',
      'only-managed',
      '--allow-existing',
    ]);
    await this.verifyRuntime(
      runtimeDirectory,
      pythonPath,
      environment,
      signal,
    );
    signal.throwIfAborted();
    await this.dependencies.writeText(
      markerPath,
      `${JSON.stringify({ version: VOXCPM2_RUNTIME_ENVIRONMENT_VERSION })}\n`,
      'utf8',
    );
  }

  private verifyRuntime(
    runtimeDirectory: string,
    pythonPath: string,
    environment: NodeJS.ProcessEnv,
    signal: AbortSignal,
  ): Promise<unknown> {
    return this.dependencies.commandRunner.run({
      command: pythonPath,
      args: [
        '-c',
        [
          'import torch, torchaudio, sherpa_onnx, soundfile',
          'from voxcpm import VoxCPM',
          "assert torch.cuda.is_available(), 'NVIDIA CUDA is unavailable'",
        ].join('; '),
      ],
      cwd: runtimeDirectory,
      env: environment,
      timeoutMs: 5 * 60 * 1_000,
      signal,
    });
  }

  private run(
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    signal: AbortSignal,
    args: readonly string[],
  ): Promise<unknown> {
    return this.dependencies.commandRunner.run({
      command,
      args,
      cwd,
      env,
      timeoutMs: SETUP_TIMEOUT_MS,
      signal,
    });
  }
}
