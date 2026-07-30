import { createHash } from 'node:crypto';
import {
  mkdir,
  open,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, isAbsolute, normalize } from 'node:path';

import { AppError } from '../errors/app-error';
import type {
  ExternalLibraryPackageDefinition,
} from './external-library-definition';

export interface ExternalLibraryDownloadProgress {
  readonly completedBytes: number;
  readonly totalBytes: number;
}

export interface ExternalLibraryDownloadResult {
  readonly packagePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface ExternalLibraryDownloaderApi {
  download(input: {
    readonly packageDefinition: ExternalLibraryPackageDefinition;
    readonly destinationPath: string;
    readonly signal: AbortSignal;
    readonly onProgress?: (
      progress: ExternalLibraryDownloadProgress,
    ) => void;
    readonly onVerifying?: () => void;
  }): Promise<ExternalLibraryDownloadResult>;
}

export interface ExternalLibraryDownloaderDependencies {
  readonly fetch: typeof globalThis.fetch;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'AbortError'
  );
}

function requireDestinationPath(value: string): string {
  const path = normalize(value.trim());

  if (!isAbsolute(path)) {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return path;
}

function validateFinalUrl(value: string): void {
  if (value.length === 0) {
    return;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch (error) {
    throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED', {
      cause: error,
    });
  }

  if (url.protocol !== 'https:') {
    throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
  }
}

async function writeAll(
  file: FileHandle,
  content: Uint8Array,
): Promise<void> {
  let offset = 0;

  while (offset < content.byteLength) {
    const { bytesWritten } = await file.write(
      content,
      offset,
      content.byteLength - offset,
    );

    if (bytesWritten <= 0) {
      throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
    }

    offset += bytesWritten;
  }
}

export class ExternalLibraryDownloader
  implements ExternalLibraryDownloaderApi
{
  private readonly fetch: typeof globalThis.fetch;

  constructor(
    dependencies: Partial<ExternalLibraryDownloaderDependencies> = {},
  ) {
    this.fetch = dependencies.fetch ?? globalThis.fetch;
  }

  async download(input: {
    readonly packageDefinition: ExternalLibraryPackageDefinition;
    readonly destinationPath: string;
    readonly signal: AbortSignal;
    readonly onProgress?: (
      progress: ExternalLibraryDownloadProgress,
    ) => void;
    readonly onVerifying?: () => void;
  }): Promise<ExternalLibraryDownloadResult> {
    const destinationPath = requireDestinationPath(
      input.destinationPath,
    );
    let file: FileHandle | undefined;
    let reader:
      | ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>
      | undefined;
    let createdDestination = false;

    try {
      if (input.signal.aborted) {
        throw new DOMException('Download cancelled', 'AbortError');
      }

      const response = await this.fetch(
        input.packageDefinition.downloadUrl,
        {
          method: 'GET',
          redirect: 'follow',
          signal: input.signal,
        },
      );

      if (!response.ok || !response.body) {
        throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED', {
          cause: new Error(`HTTP ${response.status}`),
        });
      }

      validateFinalUrl(response.url);
      const contentLength = response.headers.get('content-length');

      if (
        contentLength !== null &&
        Number(contentLength) !== input.packageDefinition.expectedSize
      ) {
        throw new AppError('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
      }

      await mkdir(dirname(destinationPath), { recursive: true });
      file = await open(destinationPath, 'wx');
      createdDestination = true;
      reader = response.body.getReader();
      const hash = createHash('sha256');
      let completedBytes = 0;

      input.onProgress?.({
        completedBytes,
        totalBytes: input.packageDefinition.expectedSize,
      });

      while (true) {
        if (input.signal.aborted) {
          throw new DOMException('Download cancelled', 'AbortError');
        }

        const result = await reader.read();

        if (result.done) {
          break;
        }

        const chunk = result.value;
        completedBytes += chunk.byteLength;

        if (completedBytes > input.packageDefinition.expectedSize) {
          throw new AppError('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
        }

        await writeAll(file, chunk);
        hash.update(chunk);
        input.onProgress?.({
          completedBytes,
          totalBytes: input.packageDefinition.expectedSize,
        });
      }

      input.onVerifying?.();
      const sha256 = hash.digest('hex');

      if (
        completedBytes !== input.packageDefinition.expectedSize ||
        sha256 !== input.packageDefinition.sha256
      ) {
        throw new AppError('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
      }

      await file.sync();

      return Object.freeze({
        packagePath: destinationPath,
        byteLength: completedBytes,
        sha256,
      });
    } catch (error) {
      await reader?.cancel().catch(() => undefined);
      await file?.close().catch(() => undefined);
      file = undefined;
      if (createdDestination) {
        await rm(destinationPath, { force: true }).catch(() => undefined);
      }

      if (isAbortError(error) || error instanceof AppError) {
        throw error;
      }

      throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED', {
        cause: error,
      });
    } finally {
      reader?.releaseLock();
      await file?.close();
    }
  }
}
