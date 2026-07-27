import type { ComponentType } from 'react';

import {
  isAssetWorkbenchManifest,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import type { WorkbenchBootstrap } from '../../shared/workbench/protocol';
import type { AssetSnapshot } from '../../shared/assets';

export interface RendererWorkbenchViewProps {
  readonly asset: AssetSnapshot;
  readonly bootstrap: WorkbenchBootstrap;
  readonly onRelink: () => void;
  readonly onRefresh: () => void;
}

export interface RendererWorkbenchModule {
  readonly manifest: AssetWorkbenchManifest;
  readonly View: ComponentType<RendererWorkbenchViewProps>;
}

export class RendererWorkbenchRegistry {
  private readonly modules = new Map<string, RendererWorkbenchModule>();

  constructor(private readonly fallbackModule: RendererWorkbenchModule) {
    this.validateModule(fallbackModule);
    this.modules.set(fallbackModule.manifest.id, fallbackModule);
  }

  register(module: RendererWorkbenchModule): void {
    this.validateModule(module);

    if (this.modules.has(module.manifest.id)) {
      throw new Error(`Renderer Workbench 重复注册：${module.manifest.id}`);
    }

    this.modules.set(module.manifest.id, module);
  }

  resolve(workbenchId: string): RendererWorkbenchModule {
    return this.modules.get(workbenchId) ?? this.fallbackModule;
  }

  private validateModule(module: RendererWorkbenchModule): void {
    if (!isAssetWorkbenchManifest(module.manifest)) {
      throw new Error('Renderer Workbench Manifest 无效');
    }
  }
}
