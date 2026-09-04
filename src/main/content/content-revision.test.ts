import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createContentRevision,
  createFileContentRevision,
  createStreamContentRevision,
} from './content-revision';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe('content revision', () => {
  it('streams a file into the same SHA-256 revision as byte content', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-revision-'),
    );
    temporaryDirectories.push(directory);
    const path = join(directory, 'course.docx');
    const content = new TextEncoder().encode('office source');
    await writeFile(path, content);

    await expect(createFileContentRevision(path)).resolves.toBe(
      createContentRevision(content),
    );
  });

  it('honors cancellation before opening a file', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createFileContentRevision('/not/opened', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('hashes a resolved byte stream and closes its reader', async () => {
    const content = new TextEncoder().encode('stream source');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(content);
        controller.close();
      },
    });

    await expect(
      createStreamContentRevision(async () => ({
        stream,
        byteLength: content.byteLength,
      })),
    ).resolves.toBe(createContentRevision(content));
  });

  it('uses a resolver-provided revision without consuming the stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    await expect(
      createStreamContentRevision(async () => ({
        stream,
        byteLength: 0,
        revision: 'resolver-revision',
      })),
    ).resolves.toBe('resolver-revision');
  });
});
