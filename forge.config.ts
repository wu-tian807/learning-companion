import { chmod, cp, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { FuseVersion, FuseV1Options } from '@electron/fuses';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';

import {
  CODEX_RUNTIME_DIRECTORY,
  resolveCodexRuntimeSourceDirectory,
} from './src/main/agents/codex/codex-runtime-paths';

const betterSqlite3Source = resolve('node_modules/better-sqlite3');
const napiCanvasSource = resolve('node_modules/@napi-rs/canvas');
const pdfJsSource = resolve('node_modules/pdfjs-dist');
const betterSqlite3RuntimeEntries = new Set([
  'LICENSE',
  'lib',
  'package.json',
  'prebuilds',
]);

function resolveNapiCanvasNativePackage(
  platform: string,
  arch: string,
): string {
  if (platform === 'win32' && arch === 'x64') {
    return 'canvas-win32-x64-msvc';
  }
  if (platform === 'win32' && arch === 'arm64') {
    return 'canvas-win32-arm64-msvc';
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'canvas-darwin-x64';
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return 'canvas-darwin-arm64';
  }

  throw new Error(
    `@napi-rs/canvas does not support packaged target ${platform}/${arch}`,
  );
}

async function copyBetterSqlite3(
  buildPath: string,
  platform: string,
  arch: string,
) {
  const destination = join(buildPath, 'node_modules/better-sqlite3');
  const expectedPrebuild = `${platform}-${arch}.node`;

  await mkdir(dirname(destination), { recursive: true });
  await cp(betterSqlite3Source, destination, {
    recursive: true,
    filter: (sourcePath) => {
      const relativePath = relative(betterSqlite3Source, sourcePath);
      const pathParts = relativePath.split(sep);

      if (
        relativePath &&
        !betterSqlite3RuntimeEntries.has(pathParts[0])
      ) {
        return false;
      }

      return (
        pathParts[0] !== 'prebuilds' ||
        pathParts.length === 1 ||
        pathParts[1] === expectedPrebuild
      );
    },
  });
}

async function copyNapiCanvas(
  buildPath: string,
  platform: string,
  arch: string,
) {
  const nativePackageName = resolveNapiCanvasNativePackage(
    platform,
    arch,
  );
  const nativePackageSource = resolve(
    'node_modules/@napi-rs',
    nativePackageName,
  );
  const destinationRoot = join(
    buildPath,
    'node_modules',
    '@napi-rs',
  );

  await mkdir(destinationRoot, { recursive: true });
  await Promise.all([
    cp(napiCanvasSource, join(destinationRoot, 'canvas'), {
      recursive: true,
    }),
    cp(
      nativePackageSource,
      join(destinationRoot, nativePackageName),
      { recursive: true },
    ),
  ]);
}

async function copyPdfJs(buildPath: string) {
  const destination = join(
    buildPath,
    'node_modules',
    'pdfjs-dist',
  );

  await mkdir(dirname(destination), { recursive: true });
  await cp(pdfJsSource, destination, { recursive: true });
}

async function copyCodexRuntime(
  buildPath: string,
  platform: string,
  arch: string,
) {
  const source = resolveCodexRuntimeSourceDirectory(
    platform as NodeJS.Platform,
    arch,
  );
  const destination = join(buildPath, CODEX_RUNTIME_DIRECTORY);

  await cp(source, destination, { recursive: true });

  if (platform !== 'win32') {
    await chmod(join(destination, 'bin', 'codex'), 0o755);
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpackDir: CODEX_RUNTIME_DIRECTORY,
    },
  },
  rebuildConfig: {
    // These packages ship Node-API binaries for our supported platforms.
    ignoreModules: ['better-sqlite3', '@napi-rs/canvas'],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
      config: {},
    },
  ],
  hooks: {
    // Forge's Vite plugin packages only .vite, so copy external runtime
    // dependencies after pruning and before ASAR is finalized.
    packageAfterPrune: async (_config, buildPath, _version, platform, arch) => {
      await Promise.all([
        copyBetterSqlite3(buildPath, platform, arch),
        copyNapiCanvas(buildPath, platform, arch),
        copyPdfJs(buildPath),
        copyCodexRuntime(buildPath, platform, arch),
      ]);
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new AutoUnpackNativesPlugin({}),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
