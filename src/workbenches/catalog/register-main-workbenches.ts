import type { AssetAssociationServiceApi } from '../../main/asset-associations/asset-association-service';
import type { AgentFunctionToolRegistryApi } from '../../main/agents/function-tools/agent-function-tool-registry';
import type { AssetArtifactRegistryApi } from '../../main/artifacts/asset-artifact-registry';
import type { AssetArtifactServiceApi } from '../../main/artifacts/asset-artifact-service';
import type { AssetLookup } from '../../main/assets/asset-database';
import type { AssetServiceApi } from '../../main/assets/asset-service';
import type { AnchorRegistry } from '../../main/attachments/anchor-registry';
import type { AttachmentContentFile } from '../../main/attachments/attachment-content-file';
import type { AttachmentRegistry } from '../../main/attachments/attachment-registry';
import type { AttachmentServiceApi } from '../../main/attachments/attachment-service';
import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import { AppError } from '../../main/errors/app-error';
import type { ExternalLibraryServiceApi } from '../../main/external-libraries/external-library-service';
import type { GenerationTaskDefinitionRegistry } from '../../main/generation/generation-task-definition-registry';
import type { GenerationTaskServiceApi } from '../../main/generation/generation-task-service';
import type { ProjectLookup } from '../../main/projects/project-database';
import type { WorkbenchRegistry } from '../../main/workbench/workbench-registry';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type { SandboxFrameScriptExecutor } from '../../main/workbench/interaction/sandbox-frame-script-executor';
import type { WorkbenchStateDataDatabaseApi } from '../../main/workbench/workbench-state-data-database';
import type { WorkbenchStateDatabaseApi } from '../../main/workbench/workbench-state-database';
import type { AssetWorkbenchManifest } from '../../shared/workbench/manifest';
import { areAssetWorkbenchManifestsEqual } from '../../shared/workbench/manifest';
import { AudioWorkbenchProvider } from '../audio/main';
import { audioWorkbenchManifest } from '../audio/shared';
import { documentAiMainFeature } from '../document-ai/main';
import { EpubWorkbenchProvider } from '../epub/main';
import { epubExplanationMainFeature } from '../epub/explanations/main';
import { epubWorkbenchManifest } from '../epub/shared';
import { HtmlWorkbenchProvider } from '../html/main';
import { htmlAssistantMainFeature } from '../html/generation/main';
import { htmlWorkbenchManifest } from '../html/shared';
import { ImageWorkbenchProvider } from '../image/main';
import { imageWorkbenchManifest } from '../image/shared';
import { MarkdownWorkbenchProvider } from '../markdown/main';
import { markdownWorkbenchManifest } from '../markdown/shared';
import { MindMapWorkbenchProvider } from '../mindmap/main';
import { mindMapGenerationMainFeature } from '../mindmap/generation/main';
import { mindMapWorkbenchManifest } from '../mindmap/shared';
import { OfficeWorkbenchProvider } from '../office/main';
import { officeArtifactMainFeature } from '../office/main-feature';
import { officeWorkbenchManifest } from '../office/shared';
import { PdfWorkbenchProvider } from '../pdf/main';
import { pdfMainFeature } from '../pdf/main-feature';
import { pdfWorkbenchManifest } from '../pdf/shared';
import { PlainTextWorkbenchProvider } from '../plain-text/main';
import { plainTextWorkbenchManifest } from '../plain-text/shared';
import { VideoWorkbenchProvider } from '../video/main';
import { videoWorkbenchManifest } from '../video/shared';

export interface MainWorkbenchProviderContext {
  readonly associationService: AssetAssociationServiceApi;
  readonly artifactService: AssetArtifactServiceApi;
  readonly contentResourceService: ContentResourceServiceApi;
  readonly externalLibraryService: ExternalLibraryServiceApi;
  readonly projectLookup: ProjectLookup;
  readonly stateDatabase: WorkbenchStateDatabaseApi;
  readonly stateDataDatabase: WorkbenchStateDataDatabaseApi;
  readonly sandboxFrameScripts: SandboxFrameScriptExecutor;
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
}

export interface MainWorkbenchGenerationContext {
  readonly definitions: GenerationTaskDefinitionRegistry;
  readonly assets: AssetServiceApi;
  readonly associations: AssetAssociationServiceApi;
  readonly attachments: AttachmentServiceApi;
}

export interface MainWorkbenchStartContext {
  readonly attachments: AttachmentServiceApi;
  readonly attachmentFiles: AttachmentContentFile;
  readonly generationTasks: GenerationTaskServiceApi;
  readonly assets: AssetLookup;
}

export interface MainWorkbenchRuntime {
  dispose(): void;
}

export interface MainWorkbenchContribution {
  readonly id: string;
  readonly manifest?: AssetWorkbenchManifest;
  createProvider?(
    context: MainWorkbenchProviderContext,
  ): MainWorkbenchProvider;
  registerArtifactProducers?(context: MainWorkbenchArtifactContext): void;
  registerAttachmentTypes?(context: MainWorkbenchAttachmentContext): void;
  registerAgentFunctionTools?(context: MainWorkbenchAgentToolContext): void;
  registerGenerationTaskDefinitions?(
    context: MainWorkbenchGenerationContext,
  ): void;
  start?(context: MainWorkbenchStartContext): MainWorkbenchRuntime;
}

function providerContribution(
  manifest: AssetWorkbenchManifest,
  createProvider: MainWorkbenchContribution['createProvider'],
  feature: Partial<MainWorkbenchContribution> = {},
): MainWorkbenchContribution {
  return { ...feature, id: manifest.id, manifest, createProvider };
}

export const mainWorkbenchContributions: readonly MainWorkbenchContribution[] = [
  providerContribution(plainTextWorkbenchManifest, (context) =>
    new PlainTextWorkbenchProvider(
      context.stateDatabase,
      context.stateDataDatabase,
    )),
  providerContribution(markdownWorkbenchManifest, (context) =>
    new MarkdownWorkbenchProvider(
      context.stateDatabase,
      context.stateDataDatabase,
    )),
  providerContribution(
    mindMapWorkbenchManifest,
    (context) =>
      new MindMapWorkbenchProvider(
        context.stateDatabase,
        context.associationService,
      ),
    mindMapGenerationMainFeature,
  ),
  providerContribution(
    pdfWorkbenchManifest,
    (context) =>
      new PdfWorkbenchProvider(
        context.contentResourceService,
        context.stateDatabase,
      ),
    pdfMainFeature,
  ),
  providerContribution(
    officeWorkbenchManifest,
    (context) =>
      new OfficeWorkbenchProvider(
        context.artifactService,
        context.contentResourceService,
        context.externalLibraryService,
        context.projectLookup,
        context.stateDatabase,
      ),
    officeArtifactMainFeature,
  ),
  providerContribution(
    htmlWorkbenchManifest,
    (context) =>
      new HtmlWorkbenchProvider(
        context.contentResourceService,
        context.stateDataDatabase,
        context.sandboxFrameScripts,
      ),
    htmlAssistantMainFeature,
  ),
  providerContribution(
    epubWorkbenchManifest,
    (context) =>
      new EpubWorkbenchProvider(
        context.contentResourceService,
        context.stateDatabase,
      ),
    epubExplanationMainFeature,
  ),
  providerContribution(imageWorkbenchManifest, (context) =>
    new ImageWorkbenchProvider(
      context.contentResourceService,
      context.stateDatabase,
    )),
  providerContribution(audioWorkbenchManifest, (context) =>
    new AudioWorkbenchProvider(
      context.contentResourceService,
      context.stateDatabase,
    )),
  providerContribution(videoWorkbenchManifest, (context) =>
    new VideoWorkbenchProvider(
      context.contentResourceService,
      context.stateDatabase,
    )),
  documentAiMainFeature,
];

function forEachContribution(
  action: (contribution: MainWorkbenchContribution) => void,
): void {
  const ids = new Set<string>();
  for (const contribution of mainWorkbenchContributions) {
    if (!contribution.id.trim() || ids.has(contribution.id)) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }
    ids.add(contribution.id);
    action(contribution);
  }
}

export function registerMainWorkbenchProviders(
  registry: WorkbenchRegistry,
  context: MainWorkbenchProviderContext,
): void {
  forEachContribution((contribution) => {
    if (!contribution.manifest || !contribution.createProvider) return;
    const provider = contribution.createProvider(context);
    if (
      !areAssetWorkbenchManifestsEqual(
        provider.manifest,
        contribution.manifest,
      )
    ) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }
    registry.register(provider);
  });
}

export function registerMainWorkbenchArtifacts(
  context: MainWorkbenchArtifactContext,
): void {
  forEachContribution((entry) => {
    entry.registerArtifactProducers?.(context);
  });
}

export function registerMainWorkbenchAttachments(
  context: MainWorkbenchAttachmentContext,
): void {
  forEachContribution((entry) => {
    entry.registerAttachmentTypes?.(context);
  });
}

export function registerMainWorkbenchAgentFunctionTools(
  context: MainWorkbenchAgentToolContext,
): void {
  forEachContribution((entry) => {
    entry.registerAgentFunctionTools?.(context);
  });
}

export function registerMainWorkbenchGeneration(
  context: MainWorkbenchGenerationContext,
): void {
  forEachContribution((entry) => {
    entry.registerGenerationTaskDefinitions?.(context);
  });
}

export function startMainWorkbenchContributions(
  context: MainWorkbenchStartContext,
): MainWorkbenchRuntime {
  const runtimes: MainWorkbenchRuntime[] = [];
  try {
    forEachContribution((entry) => {
      const runtime = entry.start?.(context);
      if (runtime) runtimes.push(runtime);
    });
  } catch (error) {
    for (const runtime of runtimes.reverse()) runtime.dispose();
    throw error;
  }

  return {
    dispose(): void {
      for (const runtime of runtimes.splice(0).reverse()) runtime.dispose();
    },
  };
}
