import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CodexAppServerConnectionFactory } from './codex-app-server-process';
import { resolveCodexExecutablePath } from './codex-runtime-paths';
import { CodexRuntimeService } from './codex-runtime-service';

describe.runIf(
  ['darwin', 'win32'].includes(process.platform) &&
    ['arm64', 'x64'].includes(process.arch),
)('Codex Runtime integration', () => {
  it(
    'initializes the pinned app-server and reads isolated auth state',
    async () => {
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), 'learning-companion-codex-integration-'),
      );
      const service = new CodexRuntimeService(
        new CodexAppServerConnectionFactory({
          executablePath: resolveCodexExecutablePath({
            isPackaged: false,
            resourcesPath: process.cwd(),
          }),
          codexHomePath: join(temporaryDirectory, 'home'),
        }),
      );

      try {
        await expect(service.ensureReady()).resolves.toEqual({
          phase: 'ready',
        });
        await expect(service.getAccount()).resolves.toEqual({
          account: null,
          requiresOpenaiAuth: true,
        });
      } finally {
        await service.shutdown();
        await rm(temporaryDirectory, {
          recursive: true,
          force: true,
        });
      }
    },
    30_000,
  );
});
