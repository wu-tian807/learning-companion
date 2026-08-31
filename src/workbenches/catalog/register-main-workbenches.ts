import { AppError } from '../../main/errors/app-error';
import { createWorkbenchConversationTaskDefinitionV1 } from '../../main/conversation/workbench-conversation-task-definition';
import { ProjectConversationContextProvider } from '../../main/conversation/project-conversation-context-provider';
import {
  createMainWorkbenchRuntime,
  type MainWorkbenchAgentToolContext,
  type MainWorkbenchArtifactContext,
  type MainWorkbenchAttachmentContext,
  type MainWorkbenchContribution,
  type MainWorkbenchExternalLibraryContext,
  type MainWorkbenchGenerationContext,
  type MainWorkbenchProviderContext,
  type MainWorkbenchRuntime,
  type MainWorkbenchStartContext,
} from '../../main/workbench/main-workbench-contribution';
import type { WorkbenchRegistry } from '../../main/workbench/workbench-registry';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import { areAssetWorkbenchManifestsEqual } from '../../shared/workbench/manifest';
import { audioMainWorkbenchContribution } from '../audio/main-contribution';
import { documentAiMainWorkbenchContribution } from '../document-ai/main-contribution';
import { epubMainWorkbenchContribution } from '../epub/main-contribution';
import { htmlMainWorkbenchContribution } from '../html/main-contribution';
import { imageMainWorkbenchContribution } from '../image/main-contribution';
import { markdownMainWorkbenchContribution } from '../markdown/main-contribution';
import { mediaDubbingMainWorkbenchContribution } from '../media-dubbing/main-contribution';
import { mediaSubtitlesMainWorkbenchContribution } from '../media-subtitles/main-contribution';
import { mindMapMainWorkbenchContribution } from '../mindmap/main-contribution';
import { officeMainWorkbenchContribution } from '../office/main-contribution';
import { pdfMainWorkbenchContribution } from '../pdf/main-contribution';
import { plainTextMainWorkbenchContribution } from '../plain-text/main-contribution';
import { videoMainWorkbenchContribution } from '../video/main-contribution';

export type {
  MainWorkbenchAgentToolContext,
  MainWorkbenchArtifactContext,
  MainWorkbenchAttachmentContext,
  MainWorkbenchContribution,
  MainWorkbenchExternalLibraryContext,
  MainWorkbenchGenerationContext,
  MainWorkbenchProviderContext,
  MainWorkbenchRuntime,
  MainWorkbenchStartContext,
} from '../../main/workbench/main-workbench-contribution';

export const mainWorkbenchContributions: readonly MainWorkbenchContribution[] =
  Object.freeze([
    plainTextMainWorkbenchContribution,
    markdownMainWorkbenchContribution,
    mindMapMainWorkbenchContribution,
    pdfMainWorkbenchContribution,
    officeMainWorkbenchContribution,
    htmlMainWorkbenchContribution,
    epubMainWorkbenchContribution,
    imageMainWorkbenchContribution,
    audioMainWorkbenchContribution,
    videoMainWorkbenchContribution,
    documentAiMainWorkbenchContribution,
    mediaDubbingMainWorkbenchContribution,
    mediaSubtitlesMainWorkbenchContribution,
  ]);

function forEachContribution(
  action: (contribution: MainWorkbenchContribution) => void,
): void {
  const ids = new Set<string>();
  for (const contribution of mainWorkbenchContributions) {
    const ownedIds = [
      contribution.id,
      ...(contribution.features?.map((feature) => feature.id) ?? []),
    ];
    for (const id of ownedIds) {
      if (!id.trim() || ids.has(id)) {
        throw new AppError('INVALID_EXTENSION_DEFINITION');
      }
      ids.add(id);
    }
    action(contribution);
  }
}

type RegisteredProviderContext<T extends { readonly provider?: unknown }> =
  Omit<T, 'provider'> & { readonly workbenches: WorkbenchRegistry };

function resolveContributionProvider(
  contribution: MainWorkbenchContribution,
  workbenches: WorkbenchRegistry,
): MainWorkbenchProvider | undefined {
  if (!contribution.manifest) return undefined;
  const provider = workbenches.get(contribution.manifest.id);
  if (
    !provider ||
    !areAssetWorkbenchManifestsEqual(provider.manifest, contribution.manifest)
  ) {
    throw new AppError('INVALID_EXTENSION_DEFINITION');
  }
  return provider;
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

export function registerMainWorkbenchExternalLibraries(
  context: MainWorkbenchExternalLibraryContext,
): void {
  forEachContribution((entry) => {
    entry.registerExternalLibraries?.(context);
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
  context: RegisteredProviderContext<MainWorkbenchAgentToolContext>,
): void {
  const { workbenches, ...featureContext } = context;
  forEachContribution((entry) => {
    entry.registerAgentFunctionTools?.({
      ...featureContext,
      provider: resolveContributionProvider(entry, workbenches),
    });
  });
}

export function registerMainWorkbenchGeneration(
  context: RegisteredProviderContext<MainWorkbenchGenerationContext>,
): void {
  context.conversationContexts.register(
    new ProjectConversationContextProvider(),
  );
  const { workbenches, ...featureContext } = context;
  forEachContribution((entry) => {
    entry.registerGeneration?.({
      ...featureContext,
      provider: resolveContributionProvider(entry, workbenches),
    });
  });
  context.definitions.register(
    createWorkbenchConversationTaskDefinitionV1(
      context.conversationContexts,
    ),
  );
}

export function startMainWorkbenchContributions(
  context: RegisteredProviderContext<MainWorkbenchStartContext>,
): MainWorkbenchRuntime {
  const runtimes: MainWorkbenchRuntime[] = [];
  const { workbenches, ...featureContext } = context;
  try {
    forEachContribution((entry) => {
      const runtime = entry.start?.({
        ...featureContext,
        provider: resolveContributionProvider(entry, workbenches),
      });
      if (runtime) runtimes.push(runtime);
    });
  } catch (error) {
    try {
      createMainWorkbenchRuntime(runtimes).dispose();
    } catch {
      // Preserve the contribution start failure after best-effort rollback.
    }
    throw error;
  }

  return createMainWorkbenchRuntime(runtimes);
}
