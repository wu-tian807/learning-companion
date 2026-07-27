import { shell } from 'electron';

import { LOCAL_FILE_CONTENT_KIND } from '../content/content-ref';
import { AppError } from '../errors/app-error';
import type { AssetServiceApi } from './asset-service';

export interface AssetFileServiceApi {
  revealInFolder(assetId: string): void;
}

export interface AssetFileServiceDependencies {
  readonly showItemInFolder: (path: string) => void;
}

export class AssetFileService implements AssetFileServiceApi {
  private readonly dependencies: AssetFileServiceDependencies;

  constructor(
    private readonly assetService: AssetServiceApi,
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
    const snapshot = this.assetService.get(assetId);

    if (!snapshot) {
      throw new AppError('ASSET_NOT_FOUND');
    }

    if (
      snapshot.content.status.availability !== 'available' ||
      snapshot.content.ref.kind !== LOCAL_FILE_CONTENT_KIND
    ) {
      throw new AppError('ASSET_UNAVAILABLE');
    }

    this.dependencies.showItemInFolder(snapshot.content.ref.path);
  }
}
