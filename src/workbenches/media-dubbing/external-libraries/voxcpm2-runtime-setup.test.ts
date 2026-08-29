import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExternalCommandRunnerApi } from '../../../main/external-libraries/external-command-runner';
import { VoxCpm2RuntimeSetup } from './voxcpm2-runtime-setup';

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
  it('installs and verifies the complete environment before marking it ready', async () => {
    const root = await createRuntimeRoot();
    const run = vi.fn<ExternalCommandRunnerApi['run']>(async (request) => {
      if (request.args[0] === 'venv') {
        const scripts = join(root, 'environment', 'Scripts');
        await mkdir(scripts, { recursive: true });
        await writeFile(join(scripts, 'python.exe'), 'mock');
      }
      return { stdout: '', stderr: '' };
    });
    const setup = new VoxCpm2RuntimeSetup({
      commandRunner: { run },
      platform: 'win32',
    });

    expect(await setup.isReady(root)).toBe(false);
    await setup.prepare(root, new AbortController().signal);

    expect(run.mock.calls.map(([request]) => request.args[0])).toEqual([
      'venv',
      'pip',
      'pip',
      'pip',
      '-c',
    ]);
    expect(await setup.isReady(root)).toBe(true);
    expect(
      JSON.parse(
        await readFile(
          join(root, 'environment', 'learning-companion-runtime.json'),
          'utf8',
        ),
      ),
    ).toEqual({ version: 1 });
    for (const [request] of run.mock.calls) {
      expect(request.env?.UV_CACHE_DIR).not.toContain(root);
      expect(request.env?.TEMP).toBe(request.env?.UV_CACHE_DIR);
    }
    await setup.prepare(root, new AbortController().signal);
    expect(run).toHaveBeenCalledTimes(5);
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

    await new VoxCpm2RuntimeSetup({
      commandRunner: { run },
      platform: 'win32',
    }).prepare(root, new AbortController().signal);

    expect(run.mock.calls.map(([request]) => request.args[0])).toEqual([
      'venv',
      'pip',
      'pip',
      'pip',
      '-c',
    ]);
    expect(run.mock.calls[0]?.[0].args).toContain('--clear');
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
      setup.prepare(root, new AbortController().signal),
    ).rejects.toThrow('setup failed');
    expect(await setup.isReady(root)).toBe(false);
    await expect(
      access(join(root, 'environment', 'learning-companion-runtime.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cancels setup without leaving a ready marker or setup cache', async () => {
    const root = await createRuntimeRoot();
    const controller = new AbortController();
    let setupCache = '';
    const run = vi.fn<ExternalCommandRunnerApi['run']>(
      (request) =>
        new Promise((_resolvePromise, rejectPromise) => {
          setupCache = request.env?.TEMP ?? '';
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

    const preparing = setup.prepare(root, controller.signal);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    controller.abort();

    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    expect(await setup.isReady(root)).toBe(false);
    await expect(access(setupCache)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
