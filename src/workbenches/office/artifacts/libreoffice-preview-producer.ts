import {
  copyFile,
  open,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  ExternalCommandRunnerApi,
} from '../../../main/external-libraries/external-command-runner';
import { ExternalCommandRunner } from '../../../main/external-libraries/external-command-runner';
import type {
  ExternalLibraryServiceApi,
} from '../../../main/external-libraries/external-library-service';
import {
  LIBREOFFICE_LIBRARY_ID,
  LIBREOFFICE_VERSION,
} from '../../../main/external-libraries/definitions/libreoffice';
import { AppError } from '../../../main/errors/app-error';
import type {
  AssetArtifactProduceRequest,
  AssetArtifactProducer,
  ProducedAssetArtifact,
} from '../../../main/artifacts/asset-artifact-registry';

export const LIBREOFFICE_PREVIEW_PRODUCER_ID =
  'builtin.office.preview';
export const LIBREOFFICE_PREVIEW_ARTIFACT_KEY = 'preview';
export const LIBREOFFICE_PREVIEW_PRODUCER_VERSION =
  `office-preview@4+powerpoint-animation-final-state+libreoffice@${LIBREOFFICE_VERSION}`;

const OFFICE_MEDIA_TYPES = new Set([
  'application/msword',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const OFFICE_EXTENSIONS = new Map<string, string>([
  ['application/msword', '.doc'],
  ['application/vnd.ms-powerpoint', '.ppt'],
  [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pptx',
  ],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.docx',
  ],
]);
const CONVERSION_TIMEOUT_MS = 5 * 60 * 1000;
const PDF_HEADER = new TextEncoder().encode('%PDF-');
const PDF_EOF = new TextEncoder().encode('%%EOF');

function previewFailure(detail: string): AppError {
  return new AppError('OFFICE_PREVIEW_FAILED', {
    cause: new Error(detail),
  });
}

function commandDiagnostics(stdout: string, stderr: string): string {
  return `stdout:\n${stdout.trim() || '<empty>'}\nstderr:\n${stderr.trim() || '<empty>'}`;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'AbortError'
  );
}

function powershellStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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
  private readonly enableNativePowerPoint: boolean;
  private queueTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly externalLibraries: ExternalLibraryServiceApi,
    profileDirectory: string,
    dependencies: Partial<LibreOfficePreviewProducerDependencies> = {},
  ) {
    const normalizedProfileDirectory = normalize(
      profileDirectory.trim(),
    );

    if (!isAbsolute(normalizedProfileDirectory)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    this.commandRunner =
      dependencies.commandRunner ?? new ExternalCommandRunner();
    this.enableNativePowerPoint = dependencies.commandRunner === undefined;
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
      const sourceExtension = OFFICE_EXTENSIONS.get(
        request.source.mediaType,
      );

      if (!sourceExtension) {
        throw new AppError('DATA_INTEGRITY_ERROR');
      }

      // LibreOffice on Windows can corrupt any CJK segment in its command
      // line paths. Keep the whole conversion workspace in the OS temp
      // directory, then copy the validated result back into managed staging.
      const conversionDirectory = await mkdtemp(
        join(tmpdir(), 'learning-companion-office-'),
      );

      try {
        const outputDirectory = join(conversionDirectory, 'output');
        const profileDirectory = join(conversionDirectory, 'profile');
        const stagedSourcePath = join(
          conversionDirectory,
          `source${sourceExtension}`,
        );
        await Promise.all([
          mkdir(outputDirectory, { recursive: true }),
          mkdir(profileDirectory, { recursive: true }),
          copyFile(request.source.absolutePath, stagedSourcePath),
        ]);

        const isPresentation =
          sourceExtension === '.ppt' || sourceExtension === '.pptx';
        const powerpointOutputPath = join(outputDirectory, 'source.pdf');

        if (
          process.platform === 'win32' &&
          isPresentation &&
          this.enableNativePowerPoint
        ) {
          const exportScript = [
            "$ErrorActionPreference='Stop'",
            '$app=$null',
            '$deck=$null',
            `$sourcePath=${powershellStringLiteral(stagedSourcePath)}`,
            `$outputPath=${powershellStringLiteral(powerpointOutputPath)}`,
            'try {',
            '  $app=New-Object -ComObject PowerPoint.Application',
            '  $deck=$app.Presentations.Open($sourcePath,$true,$false,$false)',
            '  foreach($slide in $deck.Slides) {',
            '    $sequence=$slide.TimeLine.MainSequence',
            '    while($sequence.Count -gt 0) {$sequence.Item(1).Delete()}',
            '    $interactive=$slide.TimeLine.InteractiveSequences',
            '    for($index=$interactive.Count;$index -ge 1;$index--) {',
            '      $interactiveSequence=$interactive.Item($index)',
            '      while($interactiveSequence.Count -gt 0) {$interactiveSequence.Item(1).Delete()}',
            '    }',
            '  }',
            // ppSaveAsPDF = 32. PowerPoint's own renderer preserves OMML
            // equations and exports the fully built slide appearance.
            '  $deck.SaveAs($outputPath,32)',
            '} finally {',
            '  if($null -ne $deck){$deck.Close()}',
            '  if($null -ne $app){$app.Quit()}',
            '}',
          ].join('; ');

          try {
            await this.commandRunner.run({
              command: join(
                process.env.SystemRoot ?? 'C:\\Windows',
                'System32',
                'WindowsPowerShell',
                'v1.0',
                'powershell.exe',
              ),
              args: [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                exportScript,
              ],
              cwd: conversionDirectory,
              timeoutMs: CONVERSION_TIMEOUT_MS,
              signal,
            });
            signal.throwIfAborted();
            await validatePdf(powerpointOutputPath);
          } catch (error) {
            if (isAbortError(error) || signal.aborted) {
              throw error;
            }
            await rm(powerpointOutputPath, { force: true }).catch(
              () => undefined,
            );
          }
        }

        let libreOfficeDiagnostics: string | undefined;
        if (!(await lstat(powerpointOutputPath).catch(() => undefined))) {
          const commandResult = await this.commandRunner.run({
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
              stagedSourcePath,
            ],
            cwd: conversionDirectory,
            timeoutMs: CONVERSION_TIMEOUT_MS,
            signal,
          });
          libreOfficeDiagnostics = commandDiagnostics(
            commandResult.stdout,
            commandResult.stderr,
          );
        }
        signal.throwIfAborted();
        const outputNames = (await readdir(outputDirectory)).filter(
          (name) => extname(name).toLowerCase() === '.pdf',
        );

        if (
          outputNames.length !== 1 ||
          outputNames[0].toLowerCase() !== 'source.pdf'
        ) {
          throw previewFailure(
            `LibreOffice produced an unexpected PDF result.\nConversion diagnostics:\n${libreOfficeDiagnostics ?? '<native PowerPoint export>'}`,
          );
        }

        const convertedPath = join(outputDirectory, outputNames[0]);
        await validatePdf(convertedPath);
        const managedOutputDirectory = join(
          request.stagingDirectory,
          'output',
        );
        const filePath = join(managedOutputDirectory, 'preview.pdf');
        await mkdir(managedOutputDirectory, { recursive: true });
        await copyFile(convertedPath, filePath);
        await validatePdf(filePath);

        return Object.freeze({
          filePath,
          mediaType: 'application/pdf',
          extension: 'pdf',
        });
      } finally {
        await rm(conversionDirectory, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
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
