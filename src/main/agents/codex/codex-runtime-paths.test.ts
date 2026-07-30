import { isAbsolute, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  CODEX_RUNTIME_DIRECTORY,
  resolveCodexExecutablePath,
  resolveCodexRuntimeSourceDirectory,
} from './codex-runtime-paths';

describe('Codex Runtime paths', () => {
  it('resolves the packaged executable from app.asar.unpacked', () => {
    expect(
      resolveCodexExecutablePath({
        isPackaged: true,
        resourcesPath: join('C:\\', 'Learning Companion', 'resources'),
        platform: 'win32',
        architecture: 'x64',
      }),
    ).toBe(
      join(
        'C:\\',
        'Learning Companion',
        'resources',
        'app.asar.unpacked',
        CODEX_RUNTIME_DIRECTORY,
        'bin',
        'codex.exe',
      ),
    );
  });

  it('resolves the development executable from the platform package', () => {
    const resolvePackageJson = vi.fn(() =>
      join(
        'D:\\',
        'repo',
        'node_modules',
        '@openai',
        'codex-win32-x64',
        'package.json',
      ),
    );

    expect(
      resolveCodexRuntimeSourceDirectory(
        'win32',
        'x64',
        resolvePackageJson,
      ),
    ).toBe(
      join(
        'D:\\',
        'repo',
        'node_modules',
        '@openai',
        'codex-win32-x64',
        'vendor',
        'x86_64-pc-windows-msvc',
      ),
    );
    expect(resolvePackageJson).toHaveBeenCalledWith(
      '@openai/codex-win32-x64',
    );
  });

  it('resolves the installed development runtime without import.meta', () => {
    expect(
      isAbsolute(
        resolveCodexExecutablePath({
          isPackaged: false,
          resourcesPath: process.cwd(),
        }),
      ),
    ).toBe(true);
  });

  it('rejects unsupported platform and architecture pairs', () => {
    expect(() =>
      resolveCodexExecutablePath({
        isPackaged: false,
        resourcesPath: join('D:\\', 'resources'),
        platform: 'linux',
        architecture: 'x64',
      }),
    ).toThrow('Codex Runtime 不支持当前平台');
  });
});
