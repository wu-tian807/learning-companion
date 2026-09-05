import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import writeFileAtomic from 'write-file-atomic';

import { expect, it, vi } from 'vitest';

import { CodexAuthFileLink, readCodexAuthSource } from './codex-auth-file-link';
import { resolveCodexAuthHomePath } from './codex-home-resolver';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lc-native-auth-link-'));
  const source = join(root, 'source'); const home = join(root, 'home');
  await mkdir(source); await mkdir(home);
  const sourceFile = join(source, 'auth.json'); const targetFile = join(home, 'auth.json');
  await writeFile(sourceFile, 'fixture-initial');
  return { root, source, home, sourceFile, targetFile, link: new CodexAuthFileLink(home, source) };
}

it('shares a single native auth file and preserves in-place refresh writes', async () => {
  const f = await fixture();
  try {
    await Promise.all([f.link.prepare(), f.link.prepare()]);
    expect((await stat(f.sourceFile)).ino).toBe((await stat(f.targetFile)).ino);
    expect(await f.link.prepare()).toBe(false);
    await writeFile(f.targetFile, 'fixture-refreshed');
    expect(await readFile(f.sourceFile, 'utf8')).toBe('fixture-refreshed');
    expect(await f.link.prepare()).toBe(true);
    expect(await f.link.prepare()).toBe(false);
    expect(await readCodexAuthSource(f.home)).toEqual({ version: 1, sourceHomePath: f.source });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

it('repairs a source replaced atomically and never revives a deleted source after restart', async () => {
  const f = await fixture();
  try {
    await f.link.prepare();
    await writeFileAtomic(f.sourceFile, 'fixture-new-account');
    expect(await f.link.prepare()).toBe(true);
    expect(await readFile(f.targetFile, 'utf8')).toBe('fixture-new-account');
    await rm(f.sourceFile);
    const authHome = await resolveCodexAuthHomePath({ managedCodexHomePath: f.home, userHomePath: f.root, environment: {} });
    expect(authHome).toBe(f.source);
    await new CodexAuthFileLink(f.home, authHome).prepare();
    await expect(stat(f.targetFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(f.sourceFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(f.sourceFile, 'fixture-restored');
    await f.link.prepare();
    expect(await readFile(f.targetFile, 'utf8')).toBe('fixture-restored');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

it('detaches only the LC entry before independent login/logout and persists that choice', async () => {
  const f = await fixture();
  try {
    await f.link.prepare();
    await f.link.detach();
    await f.link.detach();
    expect(await readFile(f.sourceFile, 'utf8')).toBe('fixture-initial');
    await expect(stat(f.targetFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await resolveCodexAuthHomePath({ managedCodexHomePath: f.home, userHomePath: f.root, environment: { CODEX_HOME: f.source } })).toBe(f.home);
    expect(await new CodexAuthFileLink(f.home, f.source).prepare()).toBe(false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

it('tries a symbolic link for cross-volume sources and never copies credentials if linking is unsupported', async () => {
  const f = await fixture();
  const createHardLink = vi.fn(async () => { throw Object.assign(new Error(), { code: 'EXDEV' }); });
  const createSymbolicLink = vi.fn(async () => { throw Object.assign(new Error(), { code: 'EPERM' }); });
  try {
    const link = new CodexAuthFileLink(f.home, f.source, { createHardLink, createSymbolicLink });
    expect(await link.prepare()).toBe(false);
    expect(await link.prepare()).toBe(false);
    expect(createSymbolicLink).toHaveBeenCalledWith(f.sourceFile, f.targetFile, 'file');
    await expect(stat(f.targetFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.sourceFile, 'utf8')).toBe('fixture-initial');
    await link.detach();
    await writeFile(f.targetFile, 'fixture-own-login');
    await link.prepare();
    expect(await readFile(f.targetFile, 'utf8')).toBe('fixture-own-login');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

it('rejects invalid ownership metadata and paths without exposing file contents', async () => {
  const f = await fixture();
  try {
    expect(() => new CodexAuthFileLink(f.home, f.home)).toThrow();
    expect(() => new CodexAuthFileLink('relative', f.source)).toThrow();
    for (const marker of ['{"secret": broken', '{"version":2,"sourceHomePath":null}', '{"version":1,"sourceHomePath":"relative"}']) {
      await writeFile(join(f.home, 'learning-companion-auth-source.json'), marker);
      const error = await f.link.prepare().catch((error: unknown) => error);
      expect(error).toMatchObject({ code: 'AGENT_PROVIDER_AUTH_REQUIRED' });
      expect(String(error)).not.toContain('secret');
      expect(await readFile(f.sourceFile, 'utf8')).toBe('fixture-initial');
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
