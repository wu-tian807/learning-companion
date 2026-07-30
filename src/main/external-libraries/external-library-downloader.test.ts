import { createHash } from 'node:crypto';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ExternalLibraryDownloader,
} from './external-library-downloader';

const temporaryDirectories: string[] = [];

async function createDestinationPath(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-runtime-download-'),
  );
  temporaryDirectories.push(directory);
  return join(directory, 'package.dmg.partial');
}

function createPackage(content: Uint8Array) {
  return {
    platform: 'darwin' as const,
    architecture: 'arm64' as const,
    packageType: 'dmg' as const,
    downloadUrl: 'https://download.example/libreoffice.dmg',
    sha256: createHash('sha256').update(content).digest('hex'),
    expectedSize: content.byteLength,
    executableRelativePath:
      'LibreOffice.app/Contents/MacOS/soffice',
    payloadRelativePath: 'LibreOffice.app',
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ExternalLibraryDownloader', () => {
  it('streams, reports progress and verifies a trusted package', async () => {
    const content = new TextEncoder().encode('trusted package content');
    const fetch = vi.fn(async () =>
      new Response(content, {
        status: 200,
        headers: {
          'content-length': String(content.byteLength),
        },
      }),
    );
    const downloader = new ExternalLibraryDownloader({ fetch });
    const destinationPath = await createDestinationPath();
    const onProgress = vi.fn();

    const result = await downloader.download({
      packageDefinition: createPackage(content),
      destinationPath,
      signal: new AbortController().signal,
      onProgress,
    });

    expect(result).toEqual({
      packagePath: destinationPath,
      byteLength: content.byteLength,
      sha256: createPackage(content).sha256,
    });
    expect(await readFile(destinationPath)).toEqual(Buffer.from(content));
    expect(onProgress).toHaveBeenLastCalledWith({
      completedBytes: content.byteLength,
      totalBytes: content.byteLength,
    });
  });

  it('deletes packages with an invalid length or hash', async () => {
    const trusted = new TextEncoder().encode('trusted');
    const received = new TextEncoder().encode('changed');
    const fetch = vi.fn(async () =>
      new Response(received, {
        status: 200,
        headers: {
          'content-length': String(received.byteLength),
        },
      }),
    );
    const downloader = new ExternalLibraryDownloader({ fetch });
    const destinationPath = await createDestinationPath();

    await expect(
      downloader.download({
        packageDefinition: createPackage(trusted),
        destinationPath,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
    await expect(access(destinationPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('deletes partial data when cancelled', async () => {
    const content = new TextEncoder().encode('trusted');
    const controller = new AbortController();
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(streamController) {
        if (sent) {
          return;
        }
        sent = true;
        streamController.enqueue(content.subarray(0, 2));
        queueMicrotask(() => controller.abort());
      },
    });
    const fetch = vi.fn(async () =>
      new Response(stream, {
        status: 200,
        headers: {
          'content-length': String(content.byteLength),
        },
      }),
    );
    const downloader = new ExternalLibraryDownloader({ fetch });
    const destinationPath = await createDestinationPath();

    await expect(
      downloader.download({
        packageDefinition: createPackage(content),
        destinationPath,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(access(destinationPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not delete a destination it did not create', async () => {
    const content = new TextEncoder().encode('trusted');
    const fetch = vi.fn(async () =>
      new Response(content, {
        status: 200,
        headers: {
          'content-length': String(content.byteLength),
        },
      }),
    );
    const downloader = new ExternalLibraryDownloader({ fetch });
    const destinationPath = await createDestinationPath();
    await writeFile(destinationPath, 'keep');

    await expect(
      downloader.download({
        packageDefinition: createPackage(content),
        destinationPath,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('EXTERNAL_LIBRARY_INSTALL_FAILED');
    await expect(readFile(destinationPath, 'utf8')).resolves.toBe('keep');
  });

  it('maps HTTP failures to an install error', async () => {
    const content = new TextEncoder().encode('trusted');
    const fetch = vi.fn(async () =>
      new Response('missing', { status: 404 }),
    );
    const downloader = new ExternalLibraryDownloader({ fetch });

    await expect(
      downloader.download({
        packageDefinition: createPackage(content),
        destinationPath: await createDestinationPath(),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('EXTERNAL_LIBRARY_INSTALL_FAILED');
  });
});
