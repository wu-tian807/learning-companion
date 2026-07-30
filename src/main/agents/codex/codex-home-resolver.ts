import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

export interface ResolveCodexHomePathInput {
  readonly managedCodexHomePath: string;
  readonly userHomePath: string;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface CodexHomeResolverDependencies {
  readonly hasCredentials: (codexHomePath: string) => Promise<boolean>;
}

async function hasReadableAuthFile(
  codexHomePath: string,
): Promise<boolean> {
  try {
    await access(join(codexHomePath, 'auth.json'), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function optionalAbsolutePath(value: string | undefined): string | null {
  const candidate = value?.trim();

  return candidate && isAbsolute(candidate)
    ? normalize(candidate)
    : null;
}

export async function resolveCodexHomePath(
  {
    managedCodexHomePath,
    userHomePath,
    environment = process.env,
  }: ResolveCodexHomePathInput,
  dependencies: Partial<CodexHomeResolverDependencies> = {},
): Promise<string> {
  if (
    !isAbsolute(managedCodexHomePath) ||
    !isAbsolute(userHomePath)
  ) {
    throw new Error('Codex Home 候选路径必须是绝对路径');
  }

  const managedHome = normalize(managedCodexHomePath);
  const configuredHome = optionalAbsolutePath(environment.CODEX_HOME);
  const defaultHome = normalize(join(userHomePath, '.codex'));
  const candidates = [configuredHome, managedHome, defaultHome].filter(
    (candidate, index, values): candidate is string =>
      candidate !== null && values.indexOf(candidate) === index,
  );
  const hasCredentials =
    dependencies.hasCredentials ?? hasReadableAuthFile;

  for (const candidate of candidates) {
    if (await hasCredentials(candidate)) {
      return candidate;
    }
  }

  return managedHome;
}
