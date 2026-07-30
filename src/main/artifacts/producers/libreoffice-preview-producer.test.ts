import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ExternalLibraryServiceApi,
} from '../../external-libraries/external-library-service';
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
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
  it('runs a headless isolated conversion and validates the PDF', async () => {
    const request = await createRequest();
    const commandRunner = {
      run: vi.fn(async (command) => {
        const outputDirectory =
          command.args[command.args.indexOf('--outdir') + 1];
        await writeFile(
          join(outputDirectory, 'course.pdf'),
          '%PDF-1.7\npreview\n%%EOF\n',
        );
        return { stdout: '', stderr: '' };
      }),
    };
    const producer = new LibreOfficePreviewProducer(
      createExternalLibraries(),
      { commandRunner },
    );

    await expect(
      producer.produce(request, new AbortController().signal),
    ).resolves.toMatchObject({
      mediaType: 'application/pdf',
      extension: 'pdf',
    });
    expect(commandRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/runtime/soffice',
        args: expect.arrayContaining([
          '--headless',
          '--convert-to',
          'pdf',
          request.source.absolutePath,
        ]),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      commandRunner.run.mock.calls[0][0].args.some((argument: string) =>
        argument.startsWith('-env:UserInstallation=file:'),
      ),
    ).toBe(true);
  });

  it('rejects an invalid conversion result', async () => {
    const request = await createRequest();
    const producer = new LibreOfficePreviewProducer(
      createExternalLibraries(),
      {
        commandRunner: {
          run: vi.fn(async (command) => {
            const outputDirectory =
              command.args[command.args.indexOf('--outdir') + 1];
            await writeFile(
              join(outputDirectory, 'course.pdf'),
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

  it('serializes LibreOffice conversions', async () => {
    const firstRequest = await createRequest('first.docx');
    const secondRequest = await createRequest('second.docx');
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolvePromise) => {
      releaseFirst = resolvePromise;
    });
    let activeCommands = 0;
    let maximumCommands = 0;
    const producer = new LibreOfficePreviewProducer(
      createExternalLibraries(),
      {
        commandRunner: {
          run: vi.fn(async (command) => {
            activeCommands += 1;
            maximumCommands = Math.max(maximumCommands, activeCommands);
            const sourcePath = command.args.at(-1)!;

            if (sourcePath.endsWith('first.docx')) {
              await firstGate;
            }

            const outputDirectory =
              command.args[command.args.indexOf('--outdir') + 1];
            await writeFile(
              join(
                outputDirectory,
                sourcePath.endsWith('first.docx')
                  ? 'first.pdf'
                  : 'second.pdf',
              ),
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
