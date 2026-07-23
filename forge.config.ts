import { cp, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { FuseVersion, FuseV1Options } from '@electron/fuses';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';

const betterSqlite3Source = resolve('node_modules/better-sqlite3');
const betterSqlite3RuntimeEntries = new Set([
  'LICENSE',
  'lib',
  'package.json',
  'prebuilds',
]);

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

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
  },
  rebuildConfig: {
    // better-sqlite3 13 ships Node-API binaries for our supported platforms.
    ignoreModules: ['better-sqlite3'],
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
    // Forge's Vite plugin packages only .vite, so copy the external native
    // dependency after pruning and before ASAR is finalized.
    packageAfterPrune: async (_config, buildPath, _version, platform, arch) => {
      await copyBetterSqlite3(buildPath, platform, arch);
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
