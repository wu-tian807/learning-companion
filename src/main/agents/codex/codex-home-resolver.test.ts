import { join, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { resolveCodexHomePath } from './codex-home-resolver';

function paths() {
  const root = resolve('test-fixtures', 'codex-homes');

  return {
    managedCodexHomePath: join(root, 'managed'),
    userHomePath: join(root, 'user'),
  };
}

describe('resolveCodexHomePath', () => {
  it('reuses an explicitly configured authenticated Codex Home', async () => {
    const input = paths();
    const configuredHome = join(input.userHomePath, 'custom-codex');

    await expect(
      resolveCodexHomePath(
        {
          ...input,
          environment: { CODEX_HOME: configuredHome },
        },
        {
          hasCredentials: vi.fn(
            async (candidate) => candidate === configuredHome,
          ),
        },
      ),
    ).resolves.toBe(configuredHome);
  });

  it('keeps an already authenticated application-managed home', async () => {
    const input = paths();

    await expect(
      resolveCodexHomePath(input, {
        hasCredentials: vi.fn(
          async (candidate) =>
            candidate === input.managedCodexHomePath,
        ),
      }),
    ).resolves.toBe(input.managedCodexHomePath);
  });

  it('reuses the standard user Codex login when managed auth is absent', async () => {
    const input = paths();
    const standardHome = join(input.userHomePath, '.codex');

    await expect(
      resolveCodexHomePath(input, {
        hasCredentials: vi.fn(
          async (candidate) => candidate === standardHome,
        ),
      }),
    ).resolves.toBe(standardHome);
  });

  it('falls back to the managed home when no credentials exist', async () => {
    const input = paths();

    await expect(
      resolveCodexHomePath(input, {
        hasCredentials: vi.fn(async () => false),
      }),
    ).resolves.toBe(input.managedCodexHomePath);
  });
});
