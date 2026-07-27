import { shell } from 'electron';

import { AppError } from '../errors/app-error';
import type { AssetDatabaseApi } from './asset-database';

export interface AssetFileServiceApi {
  revealInFolder(assetId: string): void;
}

export interface AssetFileServiceDependencies {
  readonly showItemInFolder: (path: string) => void;
}

export class AssetFileService implements AssetFileServiceApi {
  private readonly dependencies: AssetFileServiceDependencies;

  constructor(
    private readonly assetDatabase: AssetDatabaseApi,
    dependencies: Partial<AssetFileServiceDependencies> = {},
  ) {
    this.dependencies = {
      showItemInFolder:
        dependencies.showItemInFolder ??
        ((path) => {
          shell.showItemInFolder(path);
        }),
    };
  }

  revealInFolder(assetId: string): void {
    const asset = this.assetDatabase.get(assetId);

    if (!asset) {
      throw new AppError('ASSET_NOT_FOUND');
    }

    if (asset.contentLocator.availability !== 'available') {
      throw new AppError('ASSET_UNAVAILABLE');
    }

    this.dependencies.showItemInFolder(asset.contentLocator.path);
  }
}
