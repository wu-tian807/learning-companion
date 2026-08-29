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
    id: 'package-dmg',
    platform: 'darwin' as const,
    architecture: 'arm64' as const,
    packageType: 'dmg' as const,
    downloadUrl: 'https://download.example/libreoffice.dmg',
    sha256: createHash('sha256').update(content).digest('hex'),
    expectedSize: content.byteLength,
    executableRelativePath:
      'LibreOffice.app/Contents/MacOS/soffice',
    payloadRelativePath: 'LibreOffice.app',
    verifyCodeSignature: true,
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
      resourceDefinition: createPackage(content),
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
        resourceDefinition: createPackage(trusted),
        destinationPath,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
    await expect(access(destinationPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps partial data when cancelled so a later attempt can resume', async () => {
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
        resourceDefinition: createPackage(content),
        destinationPath,
        signal: controller.signal,
        onProgress(progress) {
          if (progress.completedBytes === 2) {
            controller.abort();
          }
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readFile(destinationPath)).toEqual(
      Buffer.from(content.subarray(0, 2)),
    );
  });

  it('resumes an existing partial file with a validated byte range', async () => {
    const content = new TextEncoder().encode('trusted');
    const resumeOffset = 3;
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('range')).toBe(
        `bytes=${resumeOffset}-`,
      );
      return new Response(content.subarray(resumeOffset), {
        status: 206,
        headers: {
          'content-length': String(content.byteLength - resumeOffset),
          'content-range':
            `bytes ${resumeOffset}-${content.byteLength - 1}/${content.byteLength}`,
        },
      });
    });
    const downloader = new ExternalLibraryDownloader({ fetch });
    const destinationPath = await createDestinationPath();
    await writeFile(destinationPath, content.subarray(0, resumeOffset));
    const onProgress = vi.fn();

    await expect(
      downloader.download({
        resourceDefinition: createPackage(content),
        destinationPath,
        signal: new AbortController().signal,
        onProgress,
      }),
    ).resolves.toMatchObject({ byteLength: content.byteLength });
    expect(await readFile(destinationPath)).toEqual(Buffer.from(content));
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      completedBytes: resumeOffset,
      totalBytes: content.byteLength,
    });
  });

  it('restarts only the current file when the server ignores Range', async () => {
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
    await writeFile(destinationPath, 'old');

    await expect(
      downloader.download({
        resourceDefinition: createPackage(content),
        destinationPath,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ byteLength: content.byteLength });
    expect(await readFile(destinationPath)).toEqual(Buffer.from(content));
  });

  it('retries the current file from zero when the saved range is rejected', async () => {
    const content = new TextEncoder().encode('trusted');
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 416 }))
      .mockResolvedValueOnce(
        new Response(content, {
          status: 200,
          headers: {
            'content-length': String(content.byteLength),
          },
        }),
      );
    const downloader = new ExternalLibraryDownloader({ fetch });
    const destinationPath = await createDestinationPath();
    await writeFile(destinationPath, content.subarray(0, 3));

    await expect(
      downloader.download({
        resourceDefinition: createPackage(content),
        destinationPath,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ byteLength: content.byteLength });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await readFile(destinationPath)).toEqual(Buffer.from(content));
  });

  it('reuses a complete verified download without a network request', async () => {
    const content = new TextEncoder().encode('trusted');
    const fetch = vi.fn<typeof globalThis.fetch>();
    const downloader = new ExternalLibraryDownloader({ fetch });
    const destinationPath = await createDestinationPath();
    await writeFile(destinationPath, content);

    await expect(
      downloader.download({
        resourceDefinition: createPackage(content),
        destinationPath,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ byteLength: content.byteLength });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the trusted prefix when a range response is malformed', async () => {
    const content = new TextEncoder().encode('trusted');
    const resumeOffset = 3;
    const fetch = vi.fn(async () =>
      new Response(content.subarray(resumeOffset), {
        status: 206,
        headers: {
          'content-length': String(content.byteLength - resumeOffset),
          'content-range':
            `bytes 0-${content.byteLength - 1}/${content.byteLength}`,
        },
      }),
    );
    const downloader = new ExternalLibraryDownloader({ fetch });
    const destinationPath = await createDestinationPath();
    const prefix = content.subarray(0, resumeOffset);
    await writeFile(destinationPath, prefix);

    await expect(
      downloader.download({
        resourceDefinition: createPackage(content),
        destinationPath,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
    expect(await readFile(destinationPath)).toEqual(Buffer.from(prefix));
  });

  it('keeps a short response as resumable partial data', async () => {
    const content = new TextEncoder().encode('trusted');
    const received = content.subarray(0, 3);
    const fetch = vi.fn(async () =>
      new Response(received, { status: 200 }),
    );
    const downloader = new ExternalLibraryDownloader({ fetch });
    const destinationPath = await createDestinationPath();

    await expect(
      downloader.download({
        resourceDefinition: createPackage(content),
        destinationPath,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('EXTERNAL_LIBRARY_INSTALL_FAILED');
    expect(await readFile(destinationPath)).toEqual(Buffer.from(received));
  });

  it('maps HTTP failures to an install error', async () => {
    const content = new TextEncoder().encode('trusted');
    const fetch = vi.fn(async () =>
      new Response('missing', { status: 404 }),
    );
    const downloader = new ExternalLibraryDownloader({ fetch });

    await expect(
      downloader.download({
        resourceDefinition: createPackage(content),
        destinationPath: await createDestinationPath(),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('EXTERNAL_LIBRARY_INSTALL_FAILED');
  });
});
