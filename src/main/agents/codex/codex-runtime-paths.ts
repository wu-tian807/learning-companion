import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const CODEX_RUNTIME_DIRECTORY = 'codex-runtime';

interface CodexRuntimeTarget {
  readonly packageName: string;
  readonly targetTriple: string;
  readonly executableName: string;
}

export interface ResolveCodexExecutablePathInput {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
  readonly resolvePackageJson?: (packageName: string) => string;
}

function resolvePackageJsonFromWorkingDirectory(
  packageName: string,
): string {
  const requireFromWorkingDirectory = createRequire(
    join(process.cwd(), 'package.json'),
  );

  return requireFromWorkingDirectory.resolve(
    `${packageName}/package.json`,
  );
}

function resolveTarget(
  platform: NodeJS.Platform,
  architecture: string,
): CodexRuntimeTarget {
  if (platform === 'win32' && architecture === 'x64') {
    return {
      packageName: '@openai/codex-win32-x64',
      targetTriple: 'x86_64-pc-windows-msvc',
      executableName: 'codex.exe',
    };
  }

  if (platform === 'win32' && architecture === 'arm64') {
    return {
      packageName: '@openai/codex-win32-arm64',
      targetTriple: 'aarch64-pc-windows-msvc',
      executableName: 'codex.exe',
    };
  }

  if (platform === 'darwin' && architecture === 'x64') {
    return {
      packageName: '@openai/codex-darwin-x64',
      targetTriple: 'x86_64-apple-darwin',
      executableName: 'codex',
    };
  }

  if (platform === 'darwin' && architecture === 'arm64') {
    return {
      packageName: '@openai/codex-darwin-arm64',
      targetTriple: 'aarch64-apple-darwin',
      executableName: 'codex',
    };
  }

  throw new Error(
    `Codex Runtime 不支持当前平台：${platform}-${architecture}`,
  );
}

export function resolveCodexRuntimeSourceDirectory(
  platform: NodeJS.Platform,
  architecture: string,
  resolvePackageJson: (packageName: string) => string =
    resolvePackageJsonFromWorkingDirectory,
): string {
  const target = resolveTarget(platform, architecture);
  const packageJsonPath = resolvePackageJson(target.packageName);

  return join(
    dirname(packageJsonPath),
    'vendor',
    target.targetTriple,
  );
}

export function resolveCodexExecutablePath({
  isPackaged,
  resourcesPath,
  platform = process.platform,
  architecture = process.arch,
  resolvePackageJson = resolvePackageJsonFromWorkingDirectory,
}: ResolveCodexExecutablePathInput): string {
  const target = resolveTarget(platform, architecture);

  if (isPackaged) {
    return join(
      resourcesPath,
      'app.asar.unpacked',
      CODEX_RUNTIME_DIRECTORY,
      'bin',
      target.executableName,
    );
  }

  return join(
    resolveCodexRuntimeSourceDirectory(
      platform,
      architecture,
      resolvePackageJson,
    ),
    'bin',
    target.executableName,
  );
}
