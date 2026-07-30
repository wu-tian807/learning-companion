import type {
  ChildProcessByStdio,
  SpawnOptions,
} from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { CodexAppServerConnectionFactory } from './codex-app-server-process';

type TestChild = ChildProcessByStdio<
  PassThrough,
  PassThrough,
  PassThrough
>;

function createChild(): TestChild {
  const child = new EventEmitter() as TestChild;
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 1234,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
  });
  return child;
}

describe('CodexAppServerConnectionFactory', () => {
  it('starts app-server with the selected home and no API credentials', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'learning-companion-codex-'),
    );
    const codexHomePath = join(temporaryDirectory, 'codex-home');
    const child = createChild();
    const spawnProcess = vi.fn(
      (
        _command: string,
        _args: readonly string[],
        _options: SpawnOptions,
      ) => {
        void _command;
        void _args;
        void _options;
        return child;
      },
    );
    const terminate = vi.fn(() => {
      queueMicrotask(() => {
        child.emit('close', 0, null);
      });
    });
    const factory = new CodexAppServerConnectionFactory(
      {
        executablePath: process.execPath,
        codexHomePath,
      },
      {
        environment: {
          PATH: 'test-path',
          OPENAI_API_KEY: 'must-not-leak',
          OPENAI_BASE_URL: 'https://example.invalid',
        },
        spawnProcess,
        terminator: { terminate },
      },
    );

    try {
      const connection = await factory.connect();

      expect(spawnProcess).toHaveBeenCalledWith(
        process.execPath,
        ['app-server', '--listen', 'stdio://'],
        expect.objectContaining({
          cwd: codexHomePath,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      );
      const options = spawnProcess.mock.calls[0][2];
      expect(options.env).toEqual({
        PATH: 'test-path',
        CODEX_HOME: codexHomePath,
      });

      await connection.close();
      expect(terminate).toHaveBeenCalledWith(child, false);
    } finally {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it('rejects relative runtime paths', () => {
    expect(
      () =>
        new CodexAppServerConnectionFactory({
          executablePath: 'codex.exe',
          codexHomePath: 'codex-home',
        }),
    ).toThrow('Codex Runtime 路径必须是绝对路径');
  });
});
