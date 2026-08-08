import { join, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createAppPaths } from './app-paths';

describe('app paths', () => {
  it('derives config and settings paths from Electron userData', () => {
    const userDataDirectory = resolve('test-fixtures', 'Learning Companion');

    expect(createAppPaths(userDataDirectory)).toEqual({
      userDataDirectory,
      configDirectory: join(userDataDirectory, 'config'),
      settingsFile: join(userDataDirectory, 'config', 'settings.json'),
      dataDirectory: join(userDataDirectory, 'data'),
      databaseFile: join(userDataDirectory, 'data', 'learning-companion.sqlite3'),
      agentWorkspacesDirectory: join(
        userDataDirectory,
        'agent-workspaces',
      ),
      agentRuntimesDirectory: join(
        userDataDirectory,
        'agent-runtimes',
      ),
      codexHomeDirectory: join(
        userDataDirectory,
        'agent-runtimes',
        'codex',
        'home',
      ),
    });
  });

  it('normalizes the Electron userData path', () => {
    const baseDirectory = resolve('test-fixtures');
    const userDataDirectory = `${baseDirectory}${sep}cache${sep}..${sep}Learning Companion`;

    expect(createAppPaths(userDataDirectory).userDataDirectory).toBe(
      join(baseDirectory, 'Learning Companion'),
    );
  });

  it('rejects empty and relative paths', () => {
    expect(() => createAppPaths('')).toThrow('Electron userData 路径不能为空');
    expect(() => createAppPaths('   ')).toThrow('Electron userData 路径不能为空');
    expect(() => createAppPaths(join('relative', 'Learning Companion'))).toThrow(
      'Electron userData 路径必须是绝对路径',
    );
  });
});
