import { createHash } from 'node:crypto';
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

import type { ExternalLibraryDefinition } from './external-library-definition';
import {
  ExternalLibraryDownloader,
  type ExternalLibraryDownloaderApi,
} from './external-library-downloader';
import { ExternalLibraryInstallationManifestFile } from './external-library-installation-manifest-file';
import { ExternalLibraryInstallationWorkflow } from './external-library-installation-workflow';
import {
  ExternalLibraryInstallerRegistry,
  type ExternalLibraryInstaller,
} from './external-library-installer';
import { ExternalLibraryPathManager } from './external-library-path-manager';
import { ExternalLibraryRuntimeSetupRegistry } from './external-library-runtime-setup';

const temporaryDirectories: string[] = [];

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ExternalLibraryInstallationWorkflow bundles', () => {
  it('downloads every resource, aggregates progress and commits once', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-bundle-workflow-'),
    );
    temporaryDirectories.push(directory);
    const rootPath = join(directory, 'externalLib');
    const contents = new Map([
      ['engine', Buffer.from('engine')],
      ['model', Buffer.from('model')],
    ]);
    const definition: ExternalLibraryDefinition = {
      id: 'subtitle-bundle',
      displayName: 'Subtitle bundle',
      description: 'Test subtitle resources',
      category: 'media',
      version: '1.0.0',
      installationFormatVersion: 1,
      sourceUrl: 'https://example.com/source',
      licenseName: 'MIT',
      licenseUrl: 'https://example.com/license',
      packages: [
        {
          platform: 'win32',
          architecture: 'x64',
          packageType: 'bundle',
          resources: [...contents].map(([id, content]) => ({
            id,
            downloadUrl: `https://example.com/${id}`,
            sha256: sha256(content),
            expectedSize: content.byteLength,
            installation: {
              type: 'file',
              destinationRelativePath: `${id}/${id}.bin`,
            },
          })),
          requiredRelativePaths: ['engine/engine.bin', 'model/model.bin'],
        },
      ],
    };
    const packageDefinition = definition.packages[0]!;
    const download = vi.fn<ExternalLibraryDownloaderApi['download']>(
      async ({ resourceDefinition, destinationPath, onProgress }) => {
        const content = contents.get(resourceDefinition.id)!;
        await mkdir(dirname(destinationPath), { recursive: true });
        onProgress?.({
          completedBytes: 0,
          totalBytes: content.byteLength,
        });
        await writeFile(destinationPath, content);
        onProgress?.({
          completedBytes: content.byteLength,
          totalBytes: content.byteLength,
        });
        return {
          packagePath: destinationPath,
          byteLength: content.byteLength,
          sha256: sha256(content),
        };
      },
    );
    const installer: ExternalLibraryInstaller = {
      packageType: 'bundle',
      install: vi.fn(async (request) => {
        if (request.packageDefinition.packageType !== 'bundle') {
          throw new Error('expected bundle');
        }
        for (const relativePath of request.packageDefinition
          .requiredRelativePaths) {
          const path = join(
            request.stagingInstallationDirectory,
            'runtime',
            ...relativePath.split('/'),
          );
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, relativePath);
        }
      }),
    };
    const installers = new ExternalLibraryInstallerRegistry();
    installers.register(installer);
    const runtimeSetups = new ExternalLibraryRuntimeSetupRegistry();
    let runtimeSetupCacheDirectory = '';
    const prepareRuntime = vi.fn(
      async (
        runtimeDirectory: string,
        setupCacheDirectory: string,
        _signal: AbortSignal,
        reportStatus: (statusDetail: string) => void,
      ) => {
        runtimeSetupCacheDirectory = setupCacheDirectory;
        expect(setupCacheDirectory).toContain(
          join('.downloads', definition.id),
        );
        await mkdir(setupCacheDirectory, { recursive: true });
        await writeFile(join(setupCacheDirectory, 'cache.bin'), 'cache');
        reportStatus('Installing test runtime');
        const readyPath = join(
          runtimeDirectory,
          'environment',
          'ready.json',
        );
        await mkdir(dirname(readyPath), { recursive: true });
        await writeFile(readyPath, '{}');
      },
    );
    runtimeSetups.register({
      libraryId: definition.id,
      prepare: prepareRuntime,
      async isReady(runtimeDirectory) {
        try {
          await access(join(runtimeDirectory, 'environment', 'ready.json'));
          return true;
        } catch {
          return false;
        }
      },
    });
    const stages: Array<{
      readonly status: string;
      readonly completedBytes?: number;
      readonly totalBytes?: number;
      readonly statusDetail?: string;
    }> = [];
    const workflow = new ExternalLibraryInstallationWorkflow({
      pathManager: new ExternalLibraryPathManager({
        createId: () => 'job',
      }),
      installationManifestFile:
        new ExternalLibraryInstallationManifestFile(runtimeSetups),
      downloader: { download },
      installers,
      runtimeSetups,
      now: () => 10,
      logger: { warn: vi.fn() },
    });

    const result = await workflow.run({
      rootPath,
      definition,
      packageDefinition,
      signal: new AbortController().signal,
      onStage(stage) {
        stages.push({
          status: stage.status,
          ...(stage.status === 'downloading'
            ? {
                completedBytes: stage.progress.completedBytes,
                totalBytes: stage.progress.totalBytes,
              }
            : {}),
          ...(stage.status === 'installing' && stage.statusDetail
            ? { statusDetail: stage.statusDetail }
            : {}),
        });
      },
    });

    expect(result.status).toBe('available');
    expect(download.mock.calls.map(([input]) => input.resourceDefinition.id)).toEqual([
      'engine',
      'model',
    ]);
    expect(stages).toContainEqual({
      status: 'downloading',
      completedBytes: 11,
      totalBytes: 11,
    });
    expect(stages.slice(-3)).toEqual([
      { status: 'verifying' },
      { status: 'installing' },
      {
        status: 'installing',
        statusDetail: 'Installing test runtime',
      },
    ]);
    expect(installer.install).toHaveBeenCalledOnce();
    expect(prepareRuntime).toHaveBeenCalledOnce();
    expect(runtimeSetupCacheDirectory).not.toBe('');
    await expect(access(runtimeSetupCacheDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(installer.install).toHaveBeenCalledWith(
      expect.objectContaining({
        resources: expect.arrayContaining([
          expect.objectContaining({
            path: expect.not.stringMatching(/\.partial$/u),
          }),
        ]),
      }),
      expect.any(AbortSignal),
    );
  });

  it('resumes an interrupted bundle resource and reuses completed siblings', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-bundle-resume-'),
    );
    temporaryDirectories.push(directory);
    const rootPath = join(directory, 'externalLib');
    const engine = Buffer.from('verified-engine');
    const model = Buffer.from('large-model-payload');
    const definition: ExternalLibraryDefinition = {
      id: 'model-runtime',
      displayName: 'Model runtime',
      description: 'Test resumable model resources',
      category: 'media',
      version: '1.0.0',
      installationFormatVersion: 1,
      sourceUrl: 'https://example.com/source',
      licenseName: 'MIT',
      licenseUrl: 'https://example.com/license',
      packages: [
        {
          platform: 'win32',
          architecture: 'x64',
          packageType: 'bundle',
          resources: [
            {
              id: 'engine',
              downloadUrl: 'https://example.com/engine',
              sha256: sha256(engine),
              expectedSize: engine.byteLength,
              installation: {
                type: 'file',
                destinationRelativePath: 'engine.bin',
              },
            },
            {
              id: 'model',
              downloadUrl: 'https://example.com/model',
              sha256: sha256(model),
              expectedSize: model.byteLength,
              installation: {
                type: 'file',
                destinationRelativePath: 'model.bin',
              },
            },
          ],
          requiredRelativePaths: ['engine.bin', 'model.bin'],
        },
      ],
    };
    const packageDefinition = definition.packages[0]!;
    const resumeOffset = 6;
    let modelRequestCount = 0;
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);

        if (value.endsWith('/engine')) {
          return new Response(engine, {
            status: 200,
            headers: { 'content-length': String(engine.byteLength) },
          });
        }

        modelRequestCount += 1;
        if (modelRequestCount === 1) {
          return new Response(model.subarray(0, resumeOffset), {
            status: 200,
          });
        }

        expect(new Headers(init?.headers).get('range')).toBe(
          `bytes=${resumeOffset}-`,
        );
        return new Response(model.subarray(resumeOffset), {
          status: 206,
          headers: {
            'content-length': String(model.byteLength - resumeOffset),
            'content-range':
              `bytes ${resumeOffset}-${model.byteLength - 1}/${model.byteLength}`,
          },
        });
      },
    );
    const installer: ExternalLibraryInstaller = {
      packageType: 'bundle',
      install: vi.fn(async (request) => {
        if (request.packageDefinition.packageType !== 'bundle') {
          throw new Error('expected bundle');
        }
        for (const resource of request.resources) {
          const outputPath = join(
            request.stagingInstallationDirectory,
            'runtime',
            resource.definition.installation.destinationRelativePath,
          );
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, await readFile(resource.path));
        }
      }),
    };
    const installers = new ExternalLibraryInstallerRegistry();
    installers.register(installer);
    const pathManager = new ExternalLibraryPathManager({
      createId: () => 'job',
    });
    const createWorkflow = () =>
      new ExternalLibraryInstallationWorkflow({
        pathManager: new ExternalLibraryPathManager({
          createId: () => 'job',
        }),
        installationManifestFile:
          new ExternalLibraryInstallationManifestFile(),
        downloader: new ExternalLibraryDownloader({ fetch }),
        installers,
        now: () => 10,
        logger: { warn: vi.fn() },
      });
    const run = (workflow: ExternalLibraryInstallationWorkflow) =>
      workflow.run({
        rootPath,
        definition,
        packageDefinition,
        signal: new AbortController().signal,
        onStage: () => undefined,
      });

    await expect(run(createWorkflow())).rejects.toThrow(
      'EXTERNAL_LIBRARY_INSTALL_FAILED',
    );
    if (packageDefinition.packageType !== 'bundle') {
      throw new Error('expected bundle');
    }
    const modelPaths = await pathManager.prepareDownloadPaths({
      rootPath,
      definition,
      packageDefinition,
      resourceDefinition: packageDefinition.resources[1]!,
    });
    await expect(readFile(modelPaths.partialPath)).resolves.toEqual(
      model.subarray(0, resumeOffset),
    );

    await expect(run(createWorkflow())).resolves.toMatchObject({
      status: 'available',
    });
    expect(
      fetch.mock.calls.filter(([url]) => String(url).endsWith('/engine')),
    ).toHaveLength(1);
    expect(modelRequestCount).toBe(2);
    await expect(access(modelPaths.downloadDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
