import { createHash } from 'node:crypto';
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { AppError } from '../../errors/app-error';
import type {
  ExternalLibraryBundlePackageDefinition,
  ExternalLibraryBundleResourceDefinition,
} from '../external-library-definition';
import { ExternalLibraryBundleInstaller } from './external-library-bundle-installer';

const ZIP_FIXTURE = Buffer.from(
  'UEsDBBQAAAAIAMiOEF3sv5ZMEQAAAA8AAAAXAAAAUmVsZWFzZS93aGlzcGVyLWNsaS5leGVLS8xOVUitSE0uLUlMykkFAFBLAwQUAAAACADIjhBduvMmDwoAAAAIAAAAEwAAAFJlbGVhc2UvcnVudGltZS5kbGxLS8xOVUjJyQEAUEsBAhQAFAAAAAgAyI4QXey/lkwRAAAADwAAABcAAAAAAAAAAAAAAAAAAAAAAFJlbGVhc2Uvd2hpc3Blci1jbGkuZXhlUEsBAhQAFAAAAAgAyI4QXbrzJg8KAAAACAAAABMAAAAAAAAAAAAAAAAARgAAAFJlbGVhc2UvcnVudGltZS5kbGxQSwUGAAAAAAIAAgCGAAAAgQAAAAAA',
  'base64',
);

const temporaryDirectories: string[] = [];

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function resource(
  id: string,
  content: Uint8Array,
  installation: ExternalLibraryBundleResourceDefinition['installation'],
): ExternalLibraryBundleResourceDefinition {
  return {
    id,
    downloadUrl: `https://download.example/${id}`,
    sha256: sha256(content),
    expectedSize: content.byteLength,
    installation,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ExternalLibraryBundleInstaller', () => {
  it('installs ZIP, file and GZip resources into one verified runtime', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-bundle-installer-'),
    );
    temporaryDirectories.push(directory);
    const model = Buffer.from('trusted model');
    const vocabulary = Buffer.from('trusted vocabulary');
    const compressedVocabulary = gzipSync(vocabulary);
    const definitions = [
      resource('engine', ZIP_FIXTURE, {
        type: 'zip',
        destinationRelativePath: 'engine',
      }),
      resource('model', model, {
        type: 'file',
        destinationRelativePath: 'models/model.bin',
      }),
      resource('vocabulary', compressedVocabulary, {
        type: 'gzip',
        destinationRelativePath: 'models/vocabulary.bin',
        outputSha256: sha256(vocabulary),
        outputSize: vocabulary.byteLength,
      }),
    ] as const;
    const paths = await Promise.all(
      definitions.map(async (definition) => {
        const path = join(directory, `${definition.id}.download`);
        const content =
          definition.id === 'engine'
            ? ZIP_FIXTURE
            : definition.id === 'model'
              ? model
              : compressedVocabulary;
        await writeFile(path, content);
        return { definition, path };
      }),
    );
    const packageDefinition: ExternalLibraryBundlePackageDefinition = {
      platform: 'win32',
      architecture: 'x64',
      packageType: 'bundle',
      resources: definitions,
      requiredRelativePaths: [
        'engine/Release/whisper-cli.exe',
        'models/model.bin',
        'models/vocabulary.bin',
      ],
      executableRelativePath: 'engine/Release/whisper-cli.exe',
    };
    const installationDirectory = join(directory, 'installation');

    await new ExternalLibraryBundleInstaller().install(
      {
        packageDefinition,
        resources: paths,
        stagingInstallationDirectory: installationDirectory,
      },
      new AbortController().signal,
    );

    await expect(
      readFile(
        join(
          installationDirectory,
          'runtime',
          'engine',
          'Release',
          'whisper-cli.exe',
        ),
        'utf8',
      ),
    ).resolves.toBe('fake executable');
    const sourceModelPath = paths.find(
      ({ definition }) => definition.id === 'model',
    )!.path;
    const installedModelPath = join(
      installationDirectory,
      'runtime',
      'models',
      'model.bin',
    );
    const [sourceModel, installedModel] = await Promise.all([
      lstat(sourceModelPath),
      lstat(installedModelPath),
    ]);
    expect(installedModel.ino).toBe(sourceModel.ino);
    await rm(sourceModelPath);
    await expect(
      readFile(installedModelPath, 'utf8'),
    ).resolves.toBe('trusted model');
    await expect(
      readFile(
        join(
          installationDirectory,
          'runtime',
          'models',
          'vocabulary.bin',
        ),
        'utf8',
      ),
    ).resolves.toBe('trusted vocabulary');
  });

  it('rejects a corrupted decompressed model', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-bundle-installer-'),
    );
    temporaryDirectories.push(directory);
    const output = Buffer.from('model');
    const compressed = gzipSync(output);
    const definition = resource('model', compressed, {
      type: 'gzip',
      destinationRelativePath: 'models/model.bin',
      outputSha256: '0'.repeat(64),
      outputSize: output.byteLength,
    });
    const path = join(directory, 'model.gz');
    await writeFile(path, compressed);

    await expect(
      new ExternalLibraryBundleInstaller().install(
        {
          packageDefinition: {
            platform: 'win32',
            architecture: 'x64',
            packageType: 'bundle',
            resources: [definition],
            requiredRelativePaths: ['models/model.bin'],
          },
          resources: [{ definition, path }],
          stagingInstallationDirectory: join(directory, 'installation'),
        },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expect.any(AppError));
  });

  it('rejects a bundle before commit when a required runtime file is missing', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-bundle-installer-'),
    );
    temporaryDirectories.push(directory);
    const content = Buffer.from('model');
    const definition = resource('model', content, {
      type: 'file',
      destinationRelativePath: 'models/model.bin',
    });
    const path = join(directory, 'model.bin');
    await writeFile(path, content);

    await expect(
      new ExternalLibraryBundleInstaller().install(
        {
          packageDefinition: {
            platform: 'win32',
            architecture: 'x64',
            packageType: 'bundle',
            resources: [definition],
            requiredRelativePaths: [
              'models/model.bin',
              'models/vocabulary.bin',
            ],
          },
          resources: [{ definition, path }],
          stagingInstallationDirectory: join(
            directory,
            'installation',
          ),
        },
        new AbortController().signal,
      ),
    ).rejects.toEqual(expect.any(AppError));
  });

  it('honors cancellation before touching a resource', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-bundle-installer-'),
    );
    temporaryDirectories.push(directory);
    const content = Buffer.from('model');
    const definition = resource('model', content, {
      type: 'file',
      destinationRelativePath: 'models/model.bin',
    });
    const path = join(directory, 'model.bin');
    await writeFile(path, content);
    const controller = new AbortController();
    controller.abort();
    const installationDirectory = join(directory, 'installation');

    await expect(
      new ExternalLibraryBundleInstaller().install(
        {
          packageDefinition: {
            platform: 'win32',
            architecture: 'x64',
            packageType: 'bundle',
            resources: [definition],
            requiredRelativePaths: ['models/model.bin'],
          },
          resources: [{ definition, path }],
          stagingInstallationDirectory: installationDirectory,
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      access(
        join(
          installationDirectory,
          'runtime',
          'models',
          'model.bin',
        ),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
