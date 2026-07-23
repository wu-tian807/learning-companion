import { isAbsolute, join, normalize } from 'node:path';

export interface AppPaths {
  readonly userDataDirectory: string;
  readonly configDirectory: string;
  readonly settingsFile: string;
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

  return Object.freeze({
    userDataDirectory: normalizedUserDataDirectory,
    configDirectory,
    settingsFile: join(configDirectory, 'settings.json'),
  });
}
