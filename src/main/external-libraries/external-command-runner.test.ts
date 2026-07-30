import { describe, expect, it } from 'vitest';

import {
  ExternalCommandRunner,
} from './external-command-runner';

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
