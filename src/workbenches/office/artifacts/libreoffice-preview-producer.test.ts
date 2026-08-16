import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ExternalLibraryServiceApi,
} from '../../../main/external-libraries/external-library-service';
import {
  LIBREOFFICE_PREVIEW_ARTIFACT_KEY,
  LibreOfficePreviewProducer,
} from './libreoffice-preview-producer';

const temporaryDirectories: string[] = [];

async function createRequest(name = 'course.docx') {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-office-producer-'),
  );
  temporaryDirectories.push(directory);
  const sourcePath = join(directory, name);
  const stagingDirectory = join(directory, 'staging');
  await mkdir(stagingDirectory);
  await writeFile(sourcePath, 'office source');

  return {
    source: {
      assetId: 'asset',
      mediaType:
        name.endsWith('.pptx')
          ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      absolutePath: sourcePath,
      revision: 'source-revision',
    },
    artifactKey: LIBREOFFICE_PREVIEW_ARTIFACT_KEY,
    workspacePath: directory,
    stagingDirectory,
  };
}

function createExternalLibraries(): ExternalLibraryServiceApi {
  return {
    initialize: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    list: vi.fn(() => []),
    refresh: vi.fn(),
    startInstallation: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    migrate: vi.fn(),
    requireRuntime: vi.fn(async () => ({
      libraryId: 'libreoffice',
      runtimeDirectory: '/runtime',
      executablePath: '/runtime/soffice',
    })),
    requireExecutable: vi.fn(async () => '/runtime/soffice'),
    subscribe: vi.fn(() => () => undefined),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe('LibreOfficePreviewProducer', () => {
  it('uses an injectable native PowerPoint exporter and skips LibreOffice after valid output', async () => {
    const request = await createRequest('slides.pptx');
    const libreOfficeRunner = { run: vi.fn() };
    const nativeRunner = {
      run: vi.fn(async (command) => {
        const script = command.args.at(-1) as string;
        const match = /\$outputPath='([^']+)'/u.exec(script);
        await writeFile(match![1].replaceAll("''", "'"), '%PDF-1.7\nnative\n%%EOF\n');
        return { stdout: '', stderr: '' };
      }),
    };
    const producer = new LibreOfficePreviewProducer(
      createExternalLibraries(),
      join(request.workspacePath, 'profile'),
      { commandRunner: libreOfficeRunner, nativePowerPointCommandRunner: nativeRunner, platform: 'win32' },
    );

    await expect(producer.produce(request, new AbortController().signal))
      .resolves.toMatchObject({ mediaType: 'application/pdf' });
    expect(nativeRunner.run).toHaveBeenCalledOnce();
    expect(libreOfficeRunner.run).not.toHaveBeenCalled();
  });

  it('falls back to LibreOffice when native PowerPoint is unavailable or writes a bad PDF', async () => {
    const request = await createRequest('slides.pptx');
    const nativeRunner = {
      run: vi.fn(async (command) => {
        const script = command.args.at(-1) as string;
        const match = /\$outputPath='([^']+)'/u.exec(script);
        await writeFile(match![1].replaceAll("''", "'"), 'bad pdf');
        return { stdout: '', stderr: '' };
      }),
    };
    const libreOfficeRunner = {
      run: vi.fn(async (command) => {
        const outputDirectory = command.args[command.args.indexOf('--outdir') + 1];
        await writeFile(join(outputDirectory, 'source.pdf'), '%PDF-1.7\nfallback\n%%EOF\n');
        return { stdout: '', stderr: '' };
      }),
    };
    const producer = new LibreOfficePreviewProducer(
      createExternalLibraries(),
      join(request.workspacePath, 'profile'),
      { commandRunner: libreOfficeRunner, nativePowerPointCommandRunner: nativeRunner, platform: 'win32' },
    );

    await expect(producer.produce(request, new AbortController().signal))
      .resolves.toMatchObject({ mediaType: 'application/pdf' });
    expect(nativeRunner.run).toHaveBeenCalledOnce();
    expect(libreOfficeRunner.run).toHaveBeenCalledOnce();
  });

  it('falls back to LibreOffice when PowerPoint COM is unavailable', async () => {
    const request = await createRequest('slides.pptx');
    const nativeRunner = {
      run: vi.fn(async () => { throw new Error('PowerPoint COM unavailable'); }),
    };
    const libreOfficeRunner = {
      run: vi.fn(async (command) => {
        const outputDirectory = command.args[command.args.indexOf('--outdir') + 1];
        await writeFile(join(outputDirectory, 'source.pdf'), '%PDF-1.7\nfallback\n%%EOF\n');
        return { stdout: '', stderr: '' };
      }),
    };
    const producer = new LibreOfficePreviewProducer(
      createExternalLibraries(), join(request.workspacePath, 'profile'),
      { commandRunner: libreOfficeRunner, nativePowerPointCommandRunner: nativeRunner, platform: 'win32' },
    );

    await expect(producer.produce(request, new AbortController().signal))
      .resolves.toMatchObject({ mediaType: 'application/pdf' });
    expect(nativeRunner.run).toHaveBeenCalledOnce();
    expect(libreOfficeRunner.run).toHaveBeenCalledOnce();
  });

  it('propagates native PowerPoint cancellation without starting LibreOffice', async () => {
    const request = await createRequest('slides.pptx');
    const libreOfficeRunner = { run: vi.fn() };
    const nativeRunner = {
      run: vi.fn(async () => {
        throw new DOMException('cancelled', 'AbortError');
      }),
    };
    const conversionDirectory = await mkdtemp(join(tmpdir(), 'learning-companion-native-cancel-'));
    temporaryDirectories.push(conversionDirectory);
    const removeConversionDirectory = vi.fn(async (path: string) => {
      await rm(path, { recursive: true, force: true });
    });
    const producer = new LibreOfficePreviewProducer(
      createExternalLibraries(),
      join(request.workspacePath, 'profile'),
      {
        commandRunner: libreOfficeRunner,
        nativePowerPointCommandRunner: nativeRunner,
        platform: 'win32',
        createConversionDirectory: async () => conversionDirectory,
        removeConversionDirectory,
      },
    );

    await expect(producer.produce(request, new AbortController().signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(libreOfficeRunner.run).not.toHaveBeenCalled();
    expect(removeConversionDirectory).toHaveBeenCalledWith(conversionDirectory);
  });

  it('runs a headless isolated conversion and validates the PDF', async () => {
    const request = await createRequest('中文课程.docx');
    const commandRunner = {
      run: vi.fn(async (command) => {
        const outputDirectory =
          command.args[command.args.indexOf('--outdir') + 1];
        await writeFile(
          join(outputDirectory, 'source.pdf'),
          '%PDF-1.7\npreview\n%%EOF\n',
        );
        return { stdout: '', stderr: '' };
      }),
    };
    const producer = new LibreOfficePreviewProducer(
      createExternalLibraries(),
      join(request.workspacePath, 'libreoffice-profile'),
      { commandRunner },
    );

    await expect(
      producer.produce(request, new AbortController().signal),
    ).resolves.toMatchObject({
      mediaType: 'application/pdf',
      extension: 'pdf',
    });
    expect(commandRunner.run).toHaveBeenCalledOnce();
    expect(commandRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/runtime/soffice',
        args: expect.arrayContaining([
          '--headless',
          '--convert-to',
          'pdf',
          expect.stringMatching(/[\\/]source\.docx$/u),
        ]),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      commandRunner.run.mock.calls[0][0].args.some((argument: string) =>
        argument.startsWith('-env:UserInstallation=file:'),
      ),
    ).toBe(true);
    expect(commandRunner.run.mock.calls[0][0].args).not.toContain(
      '--terminate_after_init',
    );
  });

  it('rejects an invalid conversion result', async () => {
    const request = await createRequest();
    const producer = new LibreOfficePreviewProducer(
      createExternalLibraries(),
      join(request.workspacePath, 'libreoffice-profile'),
      {
        commandRunner: {
          run: vi.fn(async (command) => {
            const outputDirectory =
              command.args[command.args.indexOf('--outdir') + 1];
            await writeFile(
              join(outputDirectory, 'source.pdf'),
              'not a pdf',
            );
            return { stdout: '', stderr: '' };
          }),
        },
      },
    );

    await expect(
      producer.produce(request, new AbortController().signal),
    ).rejects.toThrow('OFFICE_PREVIEW_FAILED');
  });

  it('preserves LibreOffice diagnostics when no PDF is produced', async () => {
    const request = await createRequest();
    const producer = new LibreOfficePreviewProducer(
      createExternalLibraries(),
      join(request.workspacePath, 'libreoffice-profile'),
      {
        commandRunner: {
          run: vi.fn(async () => ({
            stdout: 'source could not be loaded',
            stderr: 'conversion warning',
          })),
        },
      },
    );

    await expect(
      producer.produce(request, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'OFFICE_PREVIEW_FAILED',
      cause: expect.objectContaining({
        message: expect.stringContaining(
          'source could not be loaded',
        ),
      }),
    });
  });

  it('serializes LibreOffice conversions', async () => {
    const firstRequest = await createRequest('first.docx');
    const secondRequest = await createRequest('second.docx');
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolvePromise) => {
      releaseFirst = resolvePromise;
    });
    let activeCommands = 0;
    let maximumCommands = 0;
    let commandCount = 0;
    const producer = new LibreOfficePreviewProducer(
      createExternalLibraries(),
      join(firstRequest.workspacePath, 'libreoffice-profile'),
      {
        commandRunner: {
          run: vi.fn(async (command) => {
            const commandIndex = commandCount;
            commandCount += 1;
            activeCommands += 1;
            maximumCommands = Math.max(maximumCommands, activeCommands);

            if (commandIndex === 0) {
              await firstGate;
            }

            const outputDirectory =
              command.args[command.args.indexOf('--outdir') + 1];
            await writeFile(
              join(outputDirectory, 'source.pdf'),
              '%PDF-1.7\npreview\n%%EOF\n',
            );
            activeCommands -= 1;
            return { stdout: '', stderr: '' };
          }),
        },
      },
    );

    const first = producer.produce(
      firstRequest,
      new AbortController().signal,
    );
    const second = producer.produce(
      secondRequest,
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(activeCommands).toBe(1));
    releaseFirst!();
    await Promise.all([first, second]);

    expect(maximumCommands).toBe(1);
  });
});
