import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ExternalCommandRunner,
} from './external-command-runner';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ExternalCommandRunner', () => {
  it('passes arguments without a shell and captures bounded output', async () => {
    const runner = new ExternalCommandRunner();

    const result = await runner.run({
      command: process.execPath,
      args: [
        '-e',
        'process.stdout.write(process.argv[1]); process.stderr.write("warning")',
        'value with spaces; echo unsafe',
      ],
      timeoutMs: 5_000,
      outputLimit: 8,
    });

    expect(result).toEqual({
      stdout: 'value wi',
      stderr: 'warning',
    });
  });

  it('maps non-zero exits and timeouts to install failures', async () => {
    const runner = new ExternalCommandRunner();

    await expect(
      runner.run({
        command: process.execPath,
        args: ['-e', 'process.exit(3)'],
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow('EXTERNAL_LIBRARY_INSTALL_FAILED');
    await expect(
      runner.run({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        timeoutMs: 10,
      }),
    ).rejects.toThrow('EXTERNAL_LIBRARY_INSTALL_FAILED');
  });

  it('terminates an aborted command with a cancelled error', async () => {
    const runner = new ExternalCommandRunner();
    const controller = new AbortController();
    const result = runner.run({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('waits for an aborted process to close before releasing its caller', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'learning-companion-command-runner-'),
    );
    temporaryDirectories.push(directory);
    const readyPath = join(directory, 'ready');
    const closedPath = join(directory, 'closed');
    const runner = new ExternalCommandRunner();
    const controller = new AbortController();
    const result = runner.run({
      command: process.execPath,
      args: [
        '-e',
        [
          'const fs = require("node:fs");',
          'fs.writeFileSync(process.argv[1], "ready");',
          'process.on("SIGTERM", () => {',
          '  setTimeout(() => {',
          '    fs.writeFileSync(process.argv[2], "closed");',
          '    process.exit(0);',
          '  }, 30);',
          '});',
          'setInterval(() => {}, 1000);',
        ].join('\n'),
        readyPath,
        closedPath,
      ],
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    await expect
      .poll(() => access(readyPath).then(() => true).catch(() => false))
      .toBe(true);

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await expect(access(closedPath)).resolves.toBeUndefined();
  });

  it('rejects relative executable paths', async () => {
    const runner = new ExternalCommandRunner();

    await expect(
      runner.run({
        command: 'hdiutil',
        args: [],
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('DATA_INTEGRITY_ERROR');
  });
});
