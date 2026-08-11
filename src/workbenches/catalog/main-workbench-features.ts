import type { AssetLookup } from '../../main/assets/asset-database';
import type { AssetServiceApi } from '../../main/assets/asset-service';
import type { AssetAssociationServiceApi } from '../../main/asset-associations/asset-association-service';
import type { AssetArtifactRegistryApi } from '../../main/artifacts/asset-artifact-registry';
import type { AnchorRegistry } from '../../main/attachments/anchor-registry';
import type { AttachmentContentFile } from '../../main/attachments/attachment-content-file';
import type { AttachmentRegistry } from '../../main/attachments/attachment-registry';
import type { AttachmentServiceApi } from '../../main/attachments/attachment-service';
import type { GenerationTaskDefinitionRegistry } from '../../main/generation/generation-task-definition-registry';
import type { GenerationTaskServiceApi } from '../../main/generation/generation-task-service';
import type { ExternalLibraryServiceApi } from '../../main/external-libraries/external-library-service';
import { AppError } from '../../main/errors/app-error';
import { documentAiMainFeature } from '../document-ai/main';
import { epubExplanationMainFeature } from '../epub/explanations/main';
import { mindMapGenerationMainFeature } from '../mindmap/generation/main';
import { officeArtifactMainFeature } from '../office/main-feature';
import { pdfAnchorMainFeature } from '../pdf/main-feature';

export interface MainWorkbenchArtifactRegistrationContext {
  readonly artifacts: AssetArtifactRegistryApi;
  readonly externalLibraries: ExternalLibraryServiceApi;
  readonly externalLibraryProfilesDirectory: string;
}

export interface MainWorkbenchAttachmentRegistrationContext {
  readonly attachments: AttachmentRegistry;
  readonly anchors: AnchorRegistry;
}

export interface MainWorkbenchGenerationRegistrationContext {
  readonly definitions: GenerationTaskDefinitionRegistry;
  readonly assets: AssetServiceApi;
  readonly associations: AssetAssociationServiceApi;
  readonly attachments: AttachmentServiceApi;
}

export interface MainWorkbenchFeatureStartContext {
  readonly attachments: AttachmentServiceApi;
  readonly attachmentFiles: AttachmentContentFile;
  readonly generationTasks: GenerationTaskServiceApi;
  readonly assets: AssetLookup;
}

export interface MainWorkbenchFeatureRuntime {
  dispose(): void;
}

export interface MainWorkbenchFeatureDefinition {
  readonly id: string;
  registerArtifactProducers?(
    context: MainWorkbenchArtifactRegistrationContext,
  ): void;
  registerAttachmentTypes?(
    context: MainWorkbenchAttachmentRegistrationContext,
  ): void;
  registerGenerationTaskDefinitions?(
    context: MainWorkbenchGenerationRegistrationContext,
  ): void;
  start?(
    context: MainWorkbenchFeatureStartContext,
  ): MainWorkbenchFeatureRuntime;
}

const builtinMainWorkbenchFeatures: readonly MainWorkbenchFeatureDefinition[] =
  Object.freeze([
    officeArtifactMainFeature,
    pdfAnchorMainFeature,
    mindMapGenerationMainFeature,
    documentAiMainFeature,
    epubExplanationMainFeature,
  ]);

function requireUniqueFeatures(): void {
  const ids = builtinMainWorkbenchFeatures.map(({ id }) => id);

  if (
    ids.some((id) => id.trim().length === 0 || id !== id.trim()) ||
    new Set(ids).size !== ids.length
  ) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }
}

export function registerMainWorkbenchAttachmentTypes(
  context: MainWorkbenchAttachmentRegistrationContext,
): void {
  requireUniqueFeatures();
  for (const feature of builtinMainWorkbenchFeatures) {
    feature.registerAttachmentTypes?.(context);
  }
}

export function registerMainWorkbenchArtifactProducers(
  context: MainWorkbenchArtifactRegistrationContext,
): void {
  requireUniqueFeatures();
  for (const feature of builtinMainWorkbenchFeatures) {
    feature.registerArtifactProducers?.(context);
  }
}

export function registerMainWorkbenchGenerationTaskDefinitions(
  context: MainWorkbenchGenerationRegistrationContext,
): void {
  requireUniqueFeatures();
  for (const feature of builtinMainWorkbenchFeatures) {
    feature.registerGenerationTaskDefinitions?.(context);
  }
}

export function startMainWorkbenchFeatures(
  context: MainWorkbenchFeatureStartContext,
): MainWorkbenchFeatureRuntime {
  requireUniqueFeatures();
  const runtimes: MainWorkbenchFeatureRuntime[] = [];
  let disposed = false;

  try {
    for (const feature of builtinMainWorkbenchFeatures) {
      const runtime = feature.start?.(context);
      if (runtime) {
        runtimes.push(runtime);
      }
    }
  } catch (error) {
    for (const runtime of runtimes.reverse()) {
      runtime.dispose();
    }
    throw error;
  }

  return Object.freeze({
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const runtime of runtimes.reverse()) {
        runtime.dispose();
      }
    },
  });
}
