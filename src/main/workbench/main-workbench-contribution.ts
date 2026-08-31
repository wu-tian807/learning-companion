import type { AssetAssociationServiceApi } from '../asset-associations/asset-association-service';
import type { AgentFunctionToolRegistryApi } from '../agents/function-tools/agent-function-tool-registry';
import type { AssetArtifactRegistryApi } from '../artifacts/asset-artifact-registry';
import type { AssetArtifactServiceApi } from '../artifacts/asset-artifact-service';
import type { AssetLookup } from '../assets/asset-database';
import type { AssetServiceApi } from '../assets/asset-service';
import type { AnchorRegistry } from '../attachments/anchor-registry';
import type { AttachmentRegistry } from '../attachments/attachment-registry';
import type { AttachmentServiceApi } from '../attachments/attachment-service';
import type { ContentResourceServiceApi } from '../content/content-resource-service';
import { AppError } from '../errors/app-error';
import type { ExternalLibraryHardwareCapabilities } from '../external-libraries/external-library-hardware-capabilities';
import type { ExternalLibraryLifecycleRegistryApi } from '../external-libraries/external-library-lifecycle';
import type { ExternalLibraryRegistryApi } from '../external-libraries/external-library-registry';
import type { ExternalLibraryRuntimeSetupRegistryApi } from '../external-libraries/external-library-runtime-setup';
import type { ExternalLibraryServiceApi } from '../external-libraries/external-library-service';
import type { WorkbenchConversationContextProviderRegistry } from '../conversation/workbench-conversation-context-provider-registry';
import type { GenerationTaskDefinitionRegistry } from '../generation/generation-task-definition-registry';
import type { GenerationTaskServiceApi } from '../generation/generation-task-service';
import type { ProjectLookup } from '../projects/project-database';
import type { AssetWorkbenchManifest } from '../../shared/workbench/manifest';
import type { SandboxFrameScriptExecutor } from './interaction/sandbox-frame-script-executor';
import type { WorkbenchEventBusApi } from './workbench-event-bus';
import type { MainWorkbenchProvider } from './workbench-session';
import type { WorkbenchStateDataDatabaseApi } from './workbench-state-data-database';
import type { WorkbenchStateDatabaseApi } from './workbench-state-database';
import type { WorkbenchRegistry } from './workbench-registry';

export interface MainWorkbenchExternalLibraryContext {
  readonly libraries: ExternalLibraryRegistryApi;
  readonly hardware: ExternalLibraryHardwareCapabilities;
  readonly lifecycles: ExternalLibraryLifecycleRegistryApi;
  readonly runtimeSetups: ExternalLibraryRuntimeSetupRegistryApi;
}

export interface MainWorkbenchProviderContext {
  readonly associationService: AssetAssociationServiceApi;
  readonly assetService: AssetServiceApi;
  readonly artifactRegistry: AssetArtifactRegistryApi;
  readonly artifactService: AssetArtifactServiceApi;
  readonly contentResourceService: ContentResourceServiceApi;
  readonly externalLibraryService: ExternalLibraryServiceApi;
  readonly generationTasks: GenerationTaskServiceApi;
  readonly projectLookup: ProjectLookup;
  readonly stateDatabase: WorkbenchStateDatabaseApi;
  readonly stateDataDatabase: WorkbenchStateDataDatabaseApi;
  readonly sandboxFrameScripts: SandboxFrameScriptExecutor;
  readonly workbenchEvents: WorkbenchEventBusApi;
}

export interface MainWorkbenchArtifactContext {
  readonly artifacts: AssetArtifactRegistryApi;
  readonly externalLibraries: ExternalLibraryServiceApi;
  readonly externalLibraryProfilesDirectory: string;
}

export interface MainWorkbenchAttachmentContext {
  readonly attachments: AttachmentRegistry;
  readonly anchors: AnchorRegistry;
}

export interface MainWorkbenchAgentToolContext {
  readonly functionTools: AgentFunctionToolRegistryApi;
  readonly workbenches: WorkbenchRegistry;
}

export interface MainWorkbenchGenerationContext {
  readonly definitions: GenerationTaskDefinitionRegistry;
  readonly conversationContexts: WorkbenchConversationContextProviderRegistry;
  readonly assets: AssetServiceApi;
  readonly artifacts: AssetArtifactServiceApi;
  readonly associations: AssetAssociationServiceApi;
  readonly attachments: AttachmentServiceApi;
  readonly externalLibraries: ExternalLibraryServiceApi;
  readonly projects: ProjectLookup;
  readonly workbenches: WorkbenchRegistry;
}

export interface MainWorkbenchStartContext {
  readonly attachments: AttachmentServiceApi;
  readonly generationTasks: GenerationTaskServiceApi;
  readonly assets: AssetLookup;
  readonly externalLibraries: ExternalLibraryServiceApi;
  readonly workbenches: WorkbenchRegistry;
}

export interface MainWorkbenchRuntime {
  shutdown?(): Promise<void>;
  dispose(): void;
}

export interface MainWorkbenchFeatureContribution {
  readonly id: string;
  registerExternalLibraries?(
    context: MainWorkbenchExternalLibraryContext,
  ): void;
  registerArtifactProducers?(context: MainWorkbenchArtifactContext): void;
  registerAttachmentTypes?(context: MainWorkbenchAttachmentContext): void;
  registerAgentFunctionTools?(context: MainWorkbenchAgentToolContext): void;
  registerGeneration?(context: MainWorkbenchGenerationContext): void;
  start?(context: MainWorkbenchStartContext): MainWorkbenchRuntime;
}

export interface MainWorkbenchContribution extends MainWorkbenchFeatureContribution {
  readonly manifest?: AssetWorkbenchManifest;
  readonly features?: readonly MainWorkbenchFeatureContribution[];
  createProvider?(context: MainWorkbenchProviderContext): MainWorkbenchProvider;
}

function requireValidFeatures(
  features: readonly MainWorkbenchFeatureContribution[],
): void {
  const ids = new Set<string>();
  for (const feature of features) {
    if (!feature.id.trim() || ids.has(feature.id)) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }
    ids.add(feature.id);
  }
}

function disposeRuntimes(runtimes: MainWorkbenchRuntime[]): void {
  let disposalError: unknown;
  for (const runtime of runtimes.splice(0).reverse()) {
    try {
      runtime.dispose();
    } catch (error) {
      disposalError ??= error;
    }
  }
  if (disposalError !== undefined) throw disposalError;
}

async function shutdownRuntimes(
  runtimes: readonly MainWorkbenchRuntime[],
): Promise<void> {
  let shutdownError: unknown;
  for (const runtime of [...runtimes].reverse()) {
    try {
      await runtime.shutdown?.();
    } catch (error) {
      shutdownError ??= error;
    }
  }
  if (shutdownError !== undefined) throw shutdownError;
}

export function createMainWorkbenchRuntime(
  runtimes: readonly MainWorkbenchRuntime[],
): MainWorkbenchRuntime {
  const ownedRuntimes = [...runtimes];
  let shutdownTask: Promise<void> | undefined;
  return Object.freeze({
    shutdown(): Promise<void> {
      shutdownTask ??= shutdownRuntimes(ownedRuntimes);
      return shutdownTask;
    },
    dispose(): void {
      disposeRuntimes(ownedRuntimes);
    },
  });
}

export function composeMainWorkbenchContribution(
  manifest: AssetWorkbenchManifest,
  createProvider: NonNullable<MainWorkbenchContribution['createProvider']>,
  features: readonly MainWorkbenchFeatureContribution[] = [],
): MainWorkbenchContribution {
  requireValidFeatures(features);
  const ownedFeatures = Object.freeze([...features]);

  return Object.freeze({
    id: manifest.id,
    manifest,
    features: ownedFeatures,
    createProvider,
    registerExternalLibraries(context): void {
      for (const feature of ownedFeatures) {
        feature.registerExternalLibraries?.(context);
      }
    },
    registerArtifactProducers(context): void {
      for (const feature of ownedFeatures) {
        feature.registerArtifactProducers?.(context);
      }
    },
    registerAttachmentTypes(context): void {
      for (const feature of ownedFeatures) {
        feature.registerAttachmentTypes?.(context);
      }
    },
    registerAgentFunctionTools(context): void {
      for (const feature of ownedFeatures) {
        feature.registerAgentFunctionTools?.(context);
      }
    },
    registerGeneration(context): void {
      for (const feature of ownedFeatures) {
        feature.registerGeneration?.(context);
      }
    },
    start(context): MainWorkbenchRuntime {
      const runtimes: MainWorkbenchRuntime[] = [];
      try {
        for (const feature of ownedFeatures) {
          const runtime = feature.start?.(context);
          if (runtime) runtimes.push(runtime);
        }
      } catch (error) {
        try {
          disposeRuntimes(runtimes);
        } catch {
          // Preserve the feature start failure after best-effort rollback.
        }
        throw error;
      }
      return createMainWorkbenchRuntime(runtimes);
    },
  } satisfies MainWorkbenchContribution);
}
