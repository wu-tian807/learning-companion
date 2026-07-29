import type { ComponentType } from 'react';

import {
  isAssetWorkbenchManifest,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import { createCoreWorkbenchFacilityDefinitionRegistry } from '../../shared/workbench/facilities/core-facilities';
import type { WorkbenchFacilityDefinitionRegistry } from '../../shared/workbench/facilities/facility-definition-registry';
import type {
  WorkbenchBootstrap,
  WorkbenchCommand,
  WorkbenchCommandResult,
} from '../../shared/workbench/protocol';
import type { WorkbenchInteractionSnapshot } from '../../shared/workbench/interaction';
import type { AssetSnapshot } from '../../shared/assets';

export interface RendererWorkbenchViewProps {
  readonly asset: AssetSnapshot;
  readonly bootstrap: WorkbenchBootstrap;
  readonly executeCommand: (
    command: WorkbenchCommand,
  ) => Promise<WorkbenchCommandResult>;
  readonly onRelink: () => void;
  readonly onRefresh: () => void;
  readonly onReveal: () => Promise<void> | void;
  readonly onInteractionChange: (
    interaction: WorkbenchInteractionSnapshot,
  ) => void;
  readonly onOpenExternal: (url: string) => Promise<void>;
  readonly onError: (message: string) => void;
}

export interface RendererWorkbenchModule {
  readonly manifest: AssetWorkbenchManifest;
  readonly View: ComponentType<RendererWorkbenchViewProps>;
}

export type RendererWorkbenchLoader = () => Promise<RendererWorkbenchModule>;

export class RendererWorkbenchRegistry {
  private readonly modules = new Map<string, RendererWorkbenchModule>();
  private readonly loaders = new Map<string, RendererWorkbenchLoader>();
  private readonly loadingModules = new Map<
    string,
    Promise<RendererWorkbenchModule>
  >();

  constructor(
    private readonly fallbackModule: RendererWorkbenchModule,
    private readonly facilityRegistry:
      WorkbenchFacilityDefinitionRegistry =
        createCoreWorkbenchFacilityDefinitionRegistry(),
  ) {
    this.validateModule(fallbackModule);
    this.modules.set(fallbackModule.manifest.id, fallbackModule);
  }

  register(module: RendererWorkbenchModule): void {
    this.validateModule(module);

    if (this.hasRegistration(module.manifest.id)) {
      throw new Error(`Renderer Workbench 重复注册：${module.manifest.id}`);
    }

    this.modules.set(module.manifest.id, module);
  }

  registerLoader(
    workbenchId: string,
    loader: RendererWorkbenchLoader,
  ): void {
    if (!workbenchId.trim()) {
      throw new Error('Renderer Workbench ID 无效');
    }

    if (this.hasRegistration(workbenchId)) {
      throw new Error(`Renderer Workbench 重复注册：${workbenchId}`);
    }

    this.loaders.set(workbenchId, loader);
  }

  async resolve(workbenchId: string): Promise<RendererWorkbenchModule> {
    const registeredModule = this.modules.get(workbenchId);

    if (registeredModule) {
      return registeredModule;
    }

    const loader = this.loaders.get(workbenchId);

    if (!loader) {
      return this.fallbackModule;
    }

    const loadingModule = this.loadingModules.get(workbenchId);

    if (loadingModule) {
      return loadingModule;
    }

    const nextLoadingModule = loader()
      .then((module) => {
        this.validateModule(module);

        if (module.manifest.id !== workbenchId) {
          throw new Error(
            `Renderer Workbench 加载结果不匹配：${workbenchId}`,
          );
        }

        this.modules.set(workbenchId, module);
        this.loaders.delete(workbenchId);
        return module;
      })
      .finally(() => {
        this.loadingModules.delete(workbenchId);
      });

    this.loadingModules.set(workbenchId, nextLoadingModule);
    return nextLoadingModule;
  }

  private hasRegistration(workbenchId: string): boolean {
    return (
      this.modules.has(workbenchId) ||
      this.loaders.has(workbenchId) ||
      this.loadingModules.has(workbenchId)
    );
  }

  private validateModule(module: RendererWorkbenchModule): void {
    if (!isAssetWorkbenchManifest(module.manifest)) {
      throw new Error('Renderer Workbench Manifest 无效');
    }
    if (
      !this.facilityRegistry.validateDeclarations(
        module.manifest.facilities,
      )
    ) {
      throw new Error('Renderer Workbench Facility 声明无效');
    }
  }
}
