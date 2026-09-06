import { access, link, lstat, mkdir, readFile, stat, symlink, unlink } from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import writeFileAtomic from 'write-file-atomic';

import { AppError } from '../../errors/app-error';

const SOURCE_FILE = 'learning-companion-auth-source.json';

interface AuthSource {
  readonly version: 1;
  readonly sourceHomePath: string | null;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code) : undefined;
}

function fileVersion(file: Stats): string {
  return `${file.dev}:${file.ino}:${file.mtimeMs}:${file.ctimeMs}:${file.size}`;
}

export async function readCodexAuthSource(home: string): Promise<AuthSource | undefined> {
  try {
    const source: unknown = JSON.parse(await readFile(join(home, SOURCE_FILE), 'utf8'));
    if (typeof source !== 'object' || source === null ||
        !('version' in source) || source.version !== 1 || !('sourceHomePath' in source) ||
        !(source.sourceHomePath === null ||
          (typeof source.sourceHomePath === 'string' && isAbsolute(source.sourceHomePath)))) {
      throw new Error();
    }
    return source as AuthSource;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
  }
}

interface LinkDependencies {
  readonly createHardLink: typeof link;
  readonly createSymbolicLink: typeof symlink;
}

// Shares the native file, never reads/copies tokens. The marker lets a restart
// distinguish a borrowed file from an LC-owned login even after source deletion.
export class CodexAuthFileLink {
  private sourceHomePath: string | undefined;
  private sourceVersion: string | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly dependencies: LinkDependencies;

  constructor(
    private readonly homePath: string,
    sourceHomePath: string,
    dependencies: Partial<LinkDependencies> = {},
  ) {
    if (!isAbsolute(homePath) || !isAbsolute(sourceHomePath) ||
        normalize(homePath).toLowerCase() === normalize(sourceHomePath).toLowerCase()) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }
    this.sourceHomePath = sourceHomePath;
    this.dependencies = { createHardLink: link, createSymbolicLink: symlink, ...dependencies };
  }

  prepare(): Promise<boolean> {
    return this.serialize(async () => {
      if (!this.sourceHomePath) return false;
      await mkdir(this.homePath, { recursive: true });
      // Persist ownership before linking, so a crash cannot leave an untracked
      // hard link that would later be mistaken for independent credentials.
      const marker = await readCodexAuthSource(this.homePath);
      if (marker?.sourceHomePath === null) {
        this.sourceHomePath = undefined;
        return false;
      }
      if (marker?.sourceHomePath !== this.sourceHomePath) {
        await this.writeSource(this.sourceHomePath);
      }
      const sourcePath = join(this.sourceHomePath, 'auth.json');
      const targetPath = join(this.homePath, 'auth.json');
      const source = await stat(sourcePath).catch((error: unknown) => {
        if (['ENOENT', 'EACCES', 'EPERM'].includes(errorCode(error) ?? '')) return undefined;
        throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
      });
      const target = await lstat(targetPath).catch((error: unknown) => {
        if (errorCode(error) === 'ENOENT') return undefined;
        throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
      });
      const sourceVersion = source ? fileVersion(source) : undefined;
      if (source?.isFile() && target) {
        const resolvedTarget = await stat(targetPath).catch(() => undefined);
        if (resolvedTarget?.dev === source.dev && resolvedTarget.ino === source.ino) {
          const changed = sourceVersion !== this.sourceVersion;
          this.sourceVersion = sourceVersion;
          return changed;
        }
      }
      // Only unlink LC's entry; never remove or overwrite the source file.
      if (target) await unlink(targetPath);
      this.sourceVersion = undefined;
      if (!source?.isFile()) return Boolean(target);
      try {
        await this.dependencies.createHardLink(sourcePath, targetPath);
      } catch (error) {
        if (errorCode(error) === 'EEXIST') {
          const concurrentTarget = await stat(targetPath);
          if (concurrentTarget.dev === source.dev && concurrentTarget.ino === source.ino) {
            this.sourceVersion = fileVersion(concurrentTarget);
            return true;
          }
          throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
        }
        if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(errorCode(error) ?? '')) {
          throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
        }
        try {
          await this.dependencies.createSymbolicLink(sourcePath, targetPath, 'file');
        } catch {
          // Unsupported filesystems/Windows privileges must never cause a
          // fallback to the user's Home or a copied refresh-token bundle.
          // If no old alias was removed, native auth has not changed. Reporting
          // a change on every read would repeatedly log out an empty account.
          return Boolean(target);
        }
      }
      // Creating a hard link changes ctime/link count without changing tokens.
      this.sourceVersion = fileVersion(await stat(sourcePath));
      return true;
    });
  }

  detach(): Promise<void> {
    return this.serialize(async () => {
      if (!this.sourceHomePath) return;
      await mkdir(this.homePath, { recursive: true });
      // Remove the alias before declaring it independent: after a crash, a
      // leftover shared marker is safe to retry; an untracked alias is not.
      await unlink(join(this.homePath, 'auth.json')).catch((error: unknown) => {
        if (errorCode(error) !== 'ENOENT') throw new AppError('AGENT_PROVIDER_AUTH_REQUIRED');
      });
      await this.writeSource(null);
      this.sourceHomePath = undefined;
      this.sourceVersion = undefined;
    });
  }

  async hasCredentials(): Promise<boolean> {
    try {
      await access(join(this.homePath, 'auth.json'), constants.R_OK);
      return true;
    } catch { return false; }
  }

  private writeSource(sourceHomePath: string | null): Promise<void> {
    return writeFileAtomic(join(this.homePath, SOURCE_FILE), JSON.stringify({ version: 1, sourceHomePath }), { mode: 0o600 });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
