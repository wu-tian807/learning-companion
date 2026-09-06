import { join, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createManagedCodexHomePath, resolveCodexAuthHomePath } from './codex-home-resolver';

function paths() {
  const root = resolve('test-fixtures', 'codex-homes');

  return {
    managedCodexHomePath: join(root, 'managed'),
    userHomePath: join(root, 'user'),
  };
}

describe('resolveCodexAuthHomePath', () => {
  it('keeps execution in Documents even when credentials come from the user Home', async () => {
    const input = paths();
    const documents = join(input.userHomePath, 'Documents');
    const executionHome = createManagedCodexHomePath(documents);
    const authHome = await resolveCodexAuthHomePath({ ...input, managedCodexHomePath: executionHome, environment: {} }, {
      hasCredentials: async (home) => home === join(input.userHomePath, '.codex'),
    });
    expect(executionHome).toBe(join(documents, 'Learning Companion', '.codex'));
    expect(authHome).not.toBe(executionHome);
  });

  it('rejects invalid Documents paths', () => {
    for (const path of ['', '  ', 'relative']) expect(() => createManagedCodexHomePath(path)).toThrow();
  });

  it('prefers an existing LC login and supports the legacy managed credential source', async () => {
    const input = { ...paths(), environment: {}, legacyCodexHomePath: resolve('legacy') };
    expect(await resolveCodexAuthHomePath(input, { hasCredentials: async () => true })).toBe(input.managedCodexHomePath);
    expect(await resolveCodexAuthHomePath(input, {
      hasCredentials: async (path) => path === input.legacyCodexHomePath,
    })).toBe(input.legacyCodexHomePath);
  });

  it('ignores relative ambient Home values', async () => {
    const input = paths();
    const hasCredentials = vi.fn(async () => false);
    await resolveCodexAuthHomePath({ ...input, environment: { CODEX_HOME: 'relative' } }, { hasCredentials });
    expect(hasCredentials).not.toHaveBeenCalledWith('relative');
  });
  it('reuses an explicitly configured authenticated Codex Home', async () => {
    const input = paths();
    const configuredHome = join(input.userHomePath, 'custom-codex');

    await expect(
      resolveCodexAuthHomePath(
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
      resolveCodexAuthHomePath(input, {
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
      resolveCodexAuthHomePath(input, {
        hasCredentials: vi.fn(
          async (candidate) => candidate === standardHome,
        ),
      }),
    ).resolves.toBe(standardHome);
  });

  it('falls back to the managed home when no credentials exist', async () => {
    const input = paths();

    await expect(
      resolveCodexAuthHomePath(input, {
        hasCredentials: vi.fn(async () => false),
      }),
    ).resolves.toBe(input.managedCodexHomePath);
  });
});
