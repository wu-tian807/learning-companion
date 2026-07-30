import { open, lstat, mkdir, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  ExternalCommandRunnerApi,
} from '../../external-libraries/external-command-runner';
import { ExternalCommandRunner } from '../../external-libraries/external-command-runner';
import type {
  ExternalLibraryServiceApi,
} from '../../external-libraries/external-library-service';
import { LIBREOFFICE_LIBRARY_ID } from '../../external-libraries/definitions/libreoffice';
import { AppError } from '../../errors/app-error';
import type {
  AssetArtifactProduceRequest,
  AssetArtifactProducer,
  ProducedAssetArtifact,
} from '../asset-artifact-registry';

export const LIBREOFFICE_PREVIEW_PRODUCER_ID =
  'builtin.office.preview';
export const LIBREOFFICE_PREVIEW_ARTIFACT_KEY = 'preview';
export const LIBREOFFICE_PREVIEW_PRODUCER_VERSION =
  'office-preview@1+libreoffice@26.2.5';

const OFFICE_MEDIA_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const CONVERSION_TIMEOUT_MS = 5 * 60 * 1000;
const PDF_HEADER = new TextEncoder().encode('%PDF-');
const PDF_EOF = new TextEncoder().encode('%%EOF');

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'AbortError'
  );
}

function includesBytes(
  content: Uint8Array,
  expected: Uint8Array,
): boolean {
  if (expected.byteLength > content.byteLength) {
    return false;
  }

  for (
    let offset = 0;
    offset <= content.byteLength - expected.byteLength;
    offset += 1
  ) {
    if (
      expected.every(
        (value, index) => content[offset + index] === value,
      )
    ) {
      return true;
    }
  }

  return false;
}

async function validatePdf(path: string): Promise<void> {
  const stats = await lstat(path);

  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size < PDF_HEADER.byteLength + PDF_EOF.byteLength
  ) {
    throw new AppError('OFFICE_PREVIEW_FAILED');
  }

  const file = await open(path, 'r');

  try {
    const header = Buffer.alloc(PDF_HEADER.byteLength);
    await file.read(header, 0, header.byteLength, 0);

    if (!header.equals(PDF_HEADER)) {
      throw new AppError('OFFICE_PREVIEW_FAILED');
    }

    const tailLength = Math.min(stats.size, 4 * 1024);
    const tail = Buffer.alloc(tailLength);
    await file.read(
      tail,
      0,
      tailLength,
      stats.size - tailLength,
    );

    if (!includesBytes(tail, PDF_EOF)) {
      throw new AppError('OFFICE_PREVIEW_FAILED');
    }
  } finally {
    await file.close();
  }
}

function createAbortError(): DOMException {
  return new DOMException(
    'Office preview generation cancelled',
    'AbortError',
  );
}

async function waitForTurn(
  previous: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw createAbortError();
  }

  let onAbort: (() => void) | undefined;

  try {
    await Promise.race([
      previous,
      new Promise<never>((_resolvePromise, rejectPromise) => {
        onAbort = () => rejectPromise(createAbortError());
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

export interface LibreOfficePreviewProducerDependencies {
  readonly commandRunner: ExternalCommandRunnerApi;
}

export class LibreOfficePreviewProducer
  implements AssetArtifactProducer
{
  readonly id = LIBREOFFICE_PREVIEW_PRODUCER_ID;
  readonly version = LIBREOFFICE_PREVIEW_PRODUCER_VERSION;
  private readonly commandRunner: ExternalCommandRunnerApi;
  private queueTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly externalLibraries: ExternalLibraryServiceApi,
    dependencies: Partial<LibreOfficePreviewProducerDependencies> = {},
  ) {
    this.commandRunner =
      dependencies.commandRunner ?? new ExternalCommandRunner();
  }

  async produce(
    request: AssetArtifactProduceRequest,
    signal: AbortSignal,
  ): Promise<ProducedAssetArtifact> {
    if (
      request.artifactKey !==
        LIBREOFFICE_PREVIEW_ARTIFACT_KEY ||
      !OFFICE_MEDIA_TYPES.has(request.source.mediaType)
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    let releaseTurn: (() => void) | undefined;
    const turn = new Promise<void>((resolvePromise) => {
      releaseTurn = resolvePromise;
    });
    const previous = this.queueTail;
    this.queueTail = previous
      .catch(() => undefined)
      .then(() => turn);

    try {
      await waitForTurn(previous, signal);
    } catch (error) {
      releaseTurn!();
      throw error;
    }

    try {
      return await this.convert(request, signal);
    } finally {
      releaseTurn!();
    }
  }

  private async convert(
    request: AssetArtifactProduceRequest,
    signal: AbortSignal,
  ): Promise<ProducedAssetArtifact> {
    signal.throwIfAborted();

    try {
      const executablePath =
        await this.externalLibraries.requireExecutable(
          LIBREOFFICE_LIBRARY_ID,
        );
      const outputDirectory = join(
        request.stagingDirectory,
        'output',
      );
      const profileDirectory = join(
        request.stagingDirectory,
        'libreoffice-profile',
      );
      await Promise.all([
        mkdir(outputDirectory, { recursive: true }),
        mkdir(profileDirectory, { recursive: true }),
      ]);
      await this.commandRunner.run({
        command: executablePath,
        args: [
          '--headless',
          '--nologo',
          '--nodefault',
          '--nofirststartwizard',
          '--norestore',
          `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
          '--convert-to',
          'pdf',
          '--outdir',
          outputDirectory,
          request.source.absolutePath,
        ],
        cwd: request.stagingDirectory,
        timeoutMs: CONVERSION_TIMEOUT_MS,
        signal,
      });
      signal.throwIfAborted();
      const outputNames = (await readdir(outputDirectory)).filter(
        (name) => extname(name).toLowerCase() === '.pdf',
      );

      if (outputNames.length !== 1) {
        throw new AppError('OFFICE_PREVIEW_FAILED');
      }

      const filePath = join(outputDirectory, outputNames[0]);
      const expectedBaseName = basename(
        request.source.absolutePath,
        extname(request.source.absolutePath),
      );

      if (
        basename(filePath, extname(filePath)) !== expectedBaseName
      ) {
        throw new AppError('OFFICE_PREVIEW_FAILED');
      }

      await validatePdf(filePath);

      return Object.freeze({
        filePath,
        mediaType: 'application/pdf',
        extension: 'pdf',
      });
    } catch (error) {
      if (
        isAbortError(error) ||
        (error instanceof AppError &&
          error.code === 'EXTERNAL_LIBRARY_NOT_INSTALLED')
      ) {
        throw error;
      }
      if (
        error instanceof AppError &&
        error.code === 'OFFICE_PREVIEW_FAILED'
      ) {
        throw error;
      }

      throw new AppError('OFFICE_PREVIEW_FAILED', {
        cause: error,
      });
    }
  }
}
