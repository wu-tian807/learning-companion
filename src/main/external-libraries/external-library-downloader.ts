import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, isAbsolute, normalize } from 'node:path';

import { AppError } from '../errors/app-error';
import {
  externalLibraryAbortReason,
  isExternalLibraryAbortError,
} from './external-library-abort';
import type {
  ExternalLibraryDownloadResourceDefinition,
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
    readonly resourceDefinition: ExternalLibraryDownloadResourceDefinition;
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
  position: number,
): Promise<void> {
  let offset = 0;

  while (offset < content.byteLength) {
    const { bytesWritten } = await file.write(
      content,
      offset,
      content.byteLength - offset,
      position + offset,
    );

    if (bytesWritten <= 0) {
      throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
    }

    offset += bytesWritten;
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

async function existingFileSize(path: string): Promise<number | undefined> {
  try {
    const stats = await lstat(path);

    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    return stats.size;
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) {
      return undefined;
    }

    throw error;
  }
}

async function hashFilePrefix(
  file: FileHandle,
  byteLength: number,
  signal: AbortSignal,
): Promise<ReturnType<typeof createHash>> {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  let position = 0;

  while (position < byteLength) {
    if (signal.aborted) {
      throw externalLibraryAbortReason(signal);
    }

    const length = Math.min(buffer.byteLength, byteLength - position);
    const { bytesRead } = await file.read(
      buffer,
      0,
      length,
      position,
    );

    if (bytesRead <= 0) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }

  return hash;
}

interface ParsedContentRange {
  readonly start: number;
  readonly end: number;
  readonly total: number;
}

function parseContentRange(value: string | null): ParsedContentRange | undefined {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(value ?? '');

  if (!match) {
    return undefined;
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);

  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    Number.isSafeInteger(total)
    ? { start, end, total }
    : undefined;
}

function validateResponseLength(
  response: Response,
  expectedSize: number,
): void {
  const contentLength = response.headers.get('content-length');

  if (contentLength !== null && Number(contentLength) !== expectedSize) {
    throw new AppError('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
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
    readonly resourceDefinition: ExternalLibraryDownloadResourceDefinition;
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
    let response: Response | undefined;
    let deleteDestinationOnError = false;

    try {
      if (input.signal.aborted) {
        throw externalLibraryAbortReason(input.signal);
      }

      await mkdir(dirname(destinationPath), { recursive: true });
      const expectedSize = input.resourceDefinition.expectedSize;
      let completedBytes = (await existingFileSize(destinationPath)) ?? 0;

      if (completedBytes > expectedSize) {
        await rm(destinationPath, { force: true });
        completedBytes = 0;
      }

      input.onProgress?.({
        completedBytes,
        totalBytes: expectedSize,
      });

      if (completedBytes === expectedSize) {
        file = await open(destinationPath, 'r');
        const hash = await hashFilePrefix(
          file,
          completedBytes,
          input.signal,
        );
        input.onVerifying?.();
        const sha256 = hash.digest('hex');
        await file.close();
        file = undefined;

        if (sha256 === input.resourceDefinition.sha256) {
          return Object.freeze({
            packagePath: destinationPath,
            byteLength: completedBytes,
            sha256,
          });
        }

        await rm(destinationPath, { force: true });
        completedBytes = 0;
        input.onProgress?.({
          completedBytes,
          totalBytes: expectedSize,
        });
      }

      const request = async (resumeOffset: number): Promise<Response> =>
        this.fetch(input.resourceDefinition.downloadUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: input.signal,
          headers:
            resumeOffset > 0
              ? {
                  'accept-encoding': 'identity',
                  range: `bytes=${resumeOffset}-`,
                }
              : { 'accept-encoding': 'identity' },
        });

      response = await request(completedBytes);

      if (completedBytes > 0 && response.status === 416) {
        await response.body?.cancel().catch(() => undefined);
        response = await request(0);
        completedBytes = 0;
        input.onProgress?.({
          completedBytes,
          totalBytes: expectedSize,
        });
      }

      if (!response.ok || !response.body) {
        throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED', {
          cause: new Error(`HTTP ${response.status}`),
        });
      }

      validateFinalUrl(response.url);
      const resumeOffset = completedBytes;
      const isResume = resumeOffset > 0 && response.status === 206;

      if (resumeOffset > 0 && response.status === 200) {
        completedBytes = 0;
        input.onProgress?.({
          completedBytes,
          totalBytes: expectedSize,
        });
      } else if (resumeOffset > 0 && !isResume) {
        throw new AppError('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
      }

      if (isResume) {
        const range = parseContentRange(
          response.headers.get('content-range'),
        );

        if (
          !range ||
          range.start !== resumeOffset ||
          range.end !== expectedSize - 1 ||
          range.total !== expectedSize
        ) {
          throw new AppError('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
        }

        validateResponseLength(response, expectedSize - resumeOffset);
      } else {
        if (response.status !== 200) {
          throw new AppError('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
        }
        validateResponseLength(response, expectedSize);
      }

      file = await open(destinationPath, isResume ? 'r+' : 'w+');
      const openedStats = await file.stat();

      if (
        !openedStats.isFile() ||
        (isResume && openedStats.size !== resumeOffset) ||
        (!isResume && openedStats.size !== 0)
      ) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      reader = response.body.getReader();
      const hash = await hashFilePrefix(
        file,
        completedBytes,
        input.signal,
      );

      while (true) {
        if (input.signal.aborted) {
          throw externalLibraryAbortReason(input.signal);
        }

        const result = await reader.read();

        if (result.done) {
          break;
        }

        const chunk = result.value;
        const nextCompletedBytes = completedBytes + chunk.byteLength;

        if (nextCompletedBytes > expectedSize) {
          deleteDestinationOnError = true;
          throw new AppError('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
        }

        await writeAll(file, chunk, completedBytes);
        hash.update(chunk);
        completedBytes = nextCompletedBytes;
        input.onProgress?.({
          completedBytes,
          totalBytes: expectedSize,
        });
      }

      await file.sync();

      if (completedBytes !== expectedSize) {
        throw new AppError('EXTERNAL_LIBRARY_INSTALL_FAILED');
      }

      input.onVerifying?.();
      const sha256 = hash.digest('hex');

      if (sha256 !== input.resourceDefinition.sha256) {
        deleteDestinationOnError = true;
        throw new AppError('EXTERNAL_LIBRARY_INTEGRITY_FAILED');
      }

      return Object.freeze({
        packagePath: destinationPath,
        byteLength: completedBytes,
        sha256,
      });
    } catch (error) {
      if (reader) {
        await reader.cancel().catch(() => undefined);
      } else {
        await response?.body?.cancel().catch(() => undefined);
      }
      await file?.sync().catch(() => undefined);
      await file?.close().catch(() => undefined);
      file = undefined;
      if (deleteDestinationOnError) {
        await rm(destinationPath, { force: true }).catch(() => undefined);
      }

      if (isExternalLibraryAbortError(error) || error instanceof AppError) {
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
