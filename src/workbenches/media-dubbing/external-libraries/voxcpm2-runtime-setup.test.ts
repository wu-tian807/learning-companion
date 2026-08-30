import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExternalCommandRunnerApi } from '../../../main/external-libraries/external-command-runner';
import {
  VOXCPM2_RUNTIME_SETUP_EXPECTED_BYTES,
  VoxCpm2RuntimeSetup,
} from './voxcpm2-runtime-setup';

const temporaryDirectories: string[] = [];

async function createRuntimeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lc-voxcpm2-setup-test-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('VoxCpm2RuntimeSetup', () => {
  it('finalizes a moved uv environment whose Python home uses a minor-version alias', async () => {
    const parent = await createRuntimeRoot();
    const root = join(parent, 'stage', 'runtime');
    await mkdir(root, { recursive: true });
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async (request) => {
      if (request.args[0] === 'venv') {
        const environmentRoot = String(request.args[1]);
        const runtimeRoot = dirname(environmentRoot);
        const scripts = join(environmentRoot, 'Scripts');
        await mkdir(scripts, { recursive: true });
        await writeFile(join(scripts, 'python.exe'), 'mock');
        const managedPythonRoot = join(runtimeRoot, 'managed-python');
        const managedPython = join(
          managedPythonRoot,
          'cpython-3.12.14-windows-x86_64-none',
        );
        await mkdir(managedPython, { recursive: true });
        await writeFile(join(managedPython, 'python.exe'), 'mock');
        await writeFile(
          join(environmentRoot, 'pyvenv.cfg'),
          `home = ${join(managedPythonRoot, 'cpython-3.12-windows-x86_64-none')}\n`,
        );
      }
      return { stdout: '', stderr: '' };
    });
    const setup = new VoxCpm2RuntimeSetup({
      commandRunner: { run },
      platform: 'win32',
    });
    const setupCache = join(root, 'download-cache');
    const statusReports: Array<{
      readonly statusDetail: string;
      readonly completedBytes?: number;
      readonly totalBytes?: number;
    }> = [];

    expect(await setup.isReady(root)).toBe(false);
    await setup.prepare(
      root,
      setupCache,
      new AbortController().signal,
      (statusDetail, progress) =>
        statusReports.push({
          statusDetail,
          ...(progress
            ? {
                completedBytes: progress.completedBytes,
                totalBytes: progress.totalBytes,
              }
            : {}),
        }),
    );

    expect(await setup.isReady(root)).toBe(false);
    expect(run.mock.calls.map(([request]) => request.args[0])).toEqual([
      'venv',
      'pip',
      'pip',
      'pip',
      '-c',
    ]);
    expect(await setup.isReady(root)).toBe(false);
    expect([...new Set(statusReports.map(({ statusDetail }) => statusDetail))]).toEqual([
      '正在准备 Python 运行环境',
      '正在下载并安装 PyTorch/CUDA 运行环境（按已写入文件估算）',
      '正在安装 VoxCPM2 配音运行依赖',
      '正在安装 GPU 人声处理运行依赖',
      '正在验证 NVIDIA GPU 配音环境',
    ]);
    expect(statusReports).not.toHaveLength(0);
    expect(
      statusReports.every(
        ({ completedBytes, totalBytes }) =>
          completedBytes !== undefined &&
          totalBytes === VOXCPM2_RUNTIME_SETUP_EXPECTED_BYTES,
      ),
    ).toBe(true);
    const completedBytes = statusReports.map(
      ({ completedBytes: value }) => value ?? 0,
    );
    expect(completedBytes).toEqual(
      [...completedBytes].sort((left, right) => left - right),
    );
    expect(completedBytes.some((value) => value > 0)).toBe(true);
    expect(Math.max(...completedBytes)).toBeLessThan(
      VOXCPM2_RUNTIME_SETUP_EXPECTED_BYTES,
    );
    expect(run.mock.calls[1]?.[0].args).toEqual(
      expect.arrayContaining([
        '--index-url',
        'https://download.pytorch.org/whl/cu128',
      ]),
    );
    await expect(
      access(join(root, 'environment', 'learning-companion-runtime.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    for (const [request] of run.mock.calls) {
      expect(request.env?.UV_CACHE_DIR).toBe(join(setupCache, 'uv'));
      expect(request.env?.PIP_CACHE_DIR).toBe(join(setupCache, 'pip'));
      expect(request.env?.TEMP).toBe(
        join(root, 'cache', 'setup-temp'),
      );
    }

    const finalRoot = join(parent, 'final', 'runtime');
    await mkdir(dirname(finalRoot), { recursive: true });
    await rename(root, finalRoot);
    await setup.finalizeInstallation(
      finalRoot,
      new AbortController().signal,
      (statusDetail) => statusReports.push({ statusDetail }),
    );

    expect(await setup.isReady(finalRoot)).toBe(true);
    expect(statusReports.at(-1)?.statusDetail).toBe(
      '正在完成配音运行环境配置',
    );
    expect(run.mock.calls.map(([request]) => request.args[0])).toEqual([
      'venv',
      'pip',
      'pip',
      'pip',
      '-c',
      'venv',
      '-c',
    ]);
    expect(run.mock.calls[5]?.[0]).toMatchObject({
      command: join(finalRoot, 'bootstrap', 'uv', 'uv.exe'),
      args: expect.arrayContaining([
        '--python',
        '3.12',
        '--allow-existing',
      ]),
    });
    expect(
      JSON.parse(
        await readFile(
          join(
            finalRoot,
            'environment',
            'learning-companion-runtime.json',
          ),
          'utf8',
        ),
      ),
    ).toEqual({ version: 2 });
    await setup.prepare(
      finalRoot,
      setupCache,
      new AbortController().signal,
      vi.fn(),
    );
    expect(run).toHaveBeenCalledTimes(7);
  });

  it('rebuilds an incomplete environment through the same install path', async () => {
    const root = await createRuntimeRoot();
    const scripts = join(root, 'environment', 'Scripts');
    await mkdir(scripts, { recursive: true });
    await writeFile(join(scripts, 'python.exe'), 'mock');
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async () => ({
      stdout: '',
      stderr: '',
    }));

    const setup = new VoxCpm2RuntimeSetup({
      commandRunner: { run },
      platform: 'win32',
    });
    await setup.prepare(
      root,
      join(root, 'download-cache'),
      new AbortController().signal,
      vi.fn(),
    );

    expect(run.mock.calls.map(([request]) => request.args[0])).toEqual([
      'venv',
      'pip',
      'pip',
      'pip',
      '-c',
    ]);
    expect(run.mock.calls[0]?.[0].args).toContain('--clear');
    expect(await setup.isReady(root)).toBe(false);
  });

  it('reports directory growth while the PyTorch install is still running', async () => {
    const root = await createRuntimeRoot();
    let finishPyTorch: (() => void) | undefined;
    let measuredBytes = 0;
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async (request) => {
      if (request.args.includes('torch==2.8.0+cu128')) {
        await new Promise<void>((resolve) => {
          finishPyTorch = resolve;
        });
      }
      return { stdout: '', stderr: '' };
    });
    const reports: number[] = [];
    const setup = new VoxCpm2RuntimeSetup({
      commandRunner: { run },
      platform: 'win32',
      measureDirectories: vi.fn(async () => measuredBytes),
      progressPollIntervalMs: 5,
    });

    const preparing = setup.prepare(
      root,
      join(root, 'download-cache'),
      new AbortController().signal,
      (_statusDetail, progress) => {
        if (progress) reports.push(progress.completedBytes);
      },
    );
    await vi.waitFor(() => expect(finishPyTorch).toBeDefined());
    measuredBytes = 123_456;
    await vi.waitFor(() => expect(reports).toContain(measuredBytes));
    finishPyTorch!();

    await expect(preparing).resolves.toBeUndefined();
    expect(reports).toEqual(
      [...reports].sort((left, right) => left - right),
    );
  });

  it('leaves the component unavailable when setup fails', async () => {
    const root = await createRuntimeRoot();
    const setup = new VoxCpm2RuntimeSetup({
      commandRunner: {
        run: vi.fn(async () => {
          throw new Error('setup failed');
        }),
      },
      platform: 'win32',
    });

    await expect(
      setup.prepare(
        root,
        join(root, 'download-cache'),
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow('setup failed');
    expect(await setup.isReady(root)).toBe(false);
    await expect(
      access(join(root, 'environment', 'learning-companion-runtime.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cancels setup without a ready marker or transient files', async () => {
    const root = await createRuntimeRoot();
    const controller = new AbortController();
    let setupTemporaryDirectory = '';
    const run = vi.fn<ExternalCommandRunnerApi['run']>(
      (request) =>
        new Promise((_resolvePromise, rejectPromise) => {
          setupTemporaryDirectory = request.env?.TEMP ?? '';
          request.signal?.addEventListener(
            'abort',
            () => rejectPromise(new DOMException('cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    const setup = new VoxCpm2RuntimeSetup({
      commandRunner: { run },
      platform: 'win32',
    });

    const preparing = setup.prepare(
      root,
      join(root, 'download-cache'),
      controller.signal,
      vi.fn(),
    );
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    controller.abort();

    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    expect(await setup.isReady(root)).toBe(false);
    expect(setupTemporaryDirectory).toBe(
      join(root, 'cache', 'setup-temp'),
    );
    await expect(access(setupTemporaryDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(access(join(root, 'download-cache'))).resolves.toBeUndefined();
  });
});
