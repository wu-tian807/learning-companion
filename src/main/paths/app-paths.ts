import { isAbsolute, join, normalize } from 'node:path';

export interface AppPaths {
  readonly userDataDirectory: string;
  readonly configDirectory: string;
  readonly settingsFile: string;
  readonly agentProviderSecretsFile: string;
  readonly dataDirectory: string;
  readonly recoveryDirectory: string;
  readonly databaseFile: string;
  readonly externalLibraryProfilesDirectory: string;
  readonly agentWorkspacesDirectory: string;
  readonly agentRuntimesDirectory: string;
  readonly codexHomeDirectory: string;
}

export function createAppPaths(userDataDirectory: string): AppPaths {
  if (userDataDirectory.trim().length === 0) {
    throw new Error('Electron userData 路径不能为空');
  }

  if (!isAbsolute(userDataDirectory)) {
    throw new Error('Electron userData 路径必须是绝对路径');
  }

  const normalizedUserDataDirectory = normalize(userDataDirectory);
  const configDirectory = join(normalizedUserDataDirectory, 'config');
  const dataDirectory = join(normalizedUserDataDirectory, 'data');
  const recoveryDirectory = join(normalizedUserDataDirectory, 'recovery');
  const agentRuntimesDirectory = join(
    normalizedUserDataDirectory,
    'agent-runtimes',
  );

  return Object.freeze({
    userDataDirectory: normalizedUserDataDirectory,
    configDirectory,
    settingsFile: join(configDirectory, 'settings.json'),
    agentProviderSecretsFile: join(
      normalizedUserDataDirectory,
      'agent-provider-secrets.json',
    ),
    dataDirectory,
    recoveryDirectory,
    databaseFile: join(dataDirectory, 'learning-companion.sqlite3'),
    externalLibraryProfilesDirectory: join(
      dataDirectory,
      'external-library-profiles',
    ),
    agentWorkspacesDirectory: join(
      normalizedUserDataDirectory,
      'agent-workspaces',
    ),
    agentRuntimesDirectory,
    codexHomeDirectory: join(agentRuntimesDirectory, 'codex', 'home'),
  });
}
