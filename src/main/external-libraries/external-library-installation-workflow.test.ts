import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExternalLibraryDefinition } from './external-library-definition';
import type { ExternalLibraryDownloaderApi } from './external-library-downloader';
import { ExternalLibraryInstallationManifestFile } from './external-library-installation-manifest-file';
import { ExternalLibraryInstallationWorkflow } from './external-library-installation-workflow';
import {
  ExternalLibraryInstallerRegistry,
  type ExternalLibraryInstaller,
} from './external-library-installer';
import { ExternalLibraryPathManager } from './external-library-path-manager';

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
    const stages: Array<{
      readonly status: string;
      readonly completedBytes?: number;
      readonly totalBytes?: number;
    }> = [];
    const workflow = new ExternalLibraryInstallationWorkflow({
      pathManager: new ExternalLibraryPathManager({
        createId: () => 'job',
      }),
      installationManifestFile:
        new ExternalLibraryInstallationManifestFile(),
      downloader: { download },
      installers,
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
    expect(stages.slice(-2).map(({ status }) => status)).toEqual([
      'verifying',
      'installing',
    ]);
    expect(installer.install).toHaveBeenCalledOnce();
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
});
