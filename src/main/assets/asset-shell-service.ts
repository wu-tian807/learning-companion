import { shell } from 'electron';

import { LOCAL_FILE_CONTENT_KIND } from '../content/content-ref';
import { AppError } from '../errors/app-error';
import type { AssetServiceApi } from './asset-service';

export interface AssetShellServiceApi {
  revealInFolder(assetId: string): void;
}

export interface AssetShellServiceDependencies {
  readonly showItemInFolder: (path: string) => void;
}

export class AssetShellService implements AssetShellServiceApi {
  private readonly dependencies: AssetShellServiceDependencies;

  constructor(
    private readonly assetService: AssetServiceApi,
    dependencies: Partial<AssetShellServiceDependencies> = {},
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
      snapshot.contentStatus.availability !== 'available' ||
      snapshot.contentRef.kind !== LOCAL_FILE_CONTENT_KIND
    ) {
      throw new AppError('ASSET_UNAVAILABLE');
    }

    this.dependencies.showItemInFolder(snapshot.contentRef.path);
  }
}
