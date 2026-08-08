import {
  isAssetWorkbenchManifest,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import {
  createCoreWorkbenchFacilityDefinitionRegistry,
} from '../../shared/workbench/facilities/core-facilities';
import type { WorkbenchFacilityDefinitionRegistry } from '../../shared/workbench/facilities/facility-definition-registry';
import { hasContentCapabilities } from '../content/content-handle';
import { AppError } from '../errors/app-error';
import type {
  MainWorkbenchProvider,
  WorkbenchSelectionReason,
} from './workbench-session';

export interface WorkbenchSelection {
  readonly provider: MainWorkbenchProvider;
  readonly reason: WorkbenchSelectionReason;
}

function mediaTypeSpecificity(
  manifest: AssetWorkbenchManifest,
  mediaType: string,
): number | undefined {
  const [type] = mediaType.split('/');
  let specificity: number | undefined;

  for (const supported of manifest.supportedMediaTypes) {
    if (supported === mediaType) {
      return 2;
    }
    if (supported === `${type}/*`) {
      specificity = Math.max(specificity ?? 0, 1);
    } else if (supported === '*/*') {
      specificity ??= 0;
    }
  }

  return specificity;
}

export class WorkbenchRegistry {
  private readonly providers = new Map<string, MainWorkbenchProvider>();

  constructor(
    private readonly fallbackProvider: MainWorkbenchProvider,
    private readonly facilityRegistry:
      WorkbenchFacilityDefinitionRegistry =
        createCoreWorkbenchFacilityDefinitionRegistry(),
  ) {
    this.validateProvider(fallbackProvider);
    this.providers.set(fallbackProvider.manifest.id, fallbackProvider);
  }

  register(provider: MainWorkbenchProvider): void {
    this.validateProvider(provider);

    if (this.providers.has(provider.manifest.id)) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    this.providers.set(provider.manifest.id, provider);
  }

  get(workbenchId: string): MainWorkbenchProvider | undefined {
    return this.providers.get(workbenchId);
  }

  fallback(reason: WorkbenchSelectionReason): WorkbenchSelection {
    return {
      provider: this.fallbackProvider,
      reason,
    };
  }

  select(
    mediaType: string,
    handle: import('../content/content-handle').ContentHandle | undefined,
  ): WorkbenchSelection {
    const mediaCandidates = [...this.providers.values()]
      .filter((provider) => provider !== this.fallbackProvider)
      .map((provider) => ({
        provider,
        specificity: mediaTypeSpecificity(
          provider.manifest,
          mediaType,
        ),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          provider: MainWorkbenchProvider;
          specificity: number;
        } => candidate.specificity !== undefined,
      );
    const candidates = mediaCandidates
      .filter(
        ({ provider }) =>
          handle !== undefined &&
          hasContentCapabilities(
            handle,
            provider.manifest.requiredContentCapabilities,
          ),
      )
      .sort((left, right) => {
        const priorityDifference =
          (right.provider.manifest.selectionPriority ?? 0) -
          (left.provider.manifest.selectionPriority ?? 0);

        return (
          priorityDifference ||
          right.specificity - left.specificity ||
          left.provider.manifest.id.localeCompare(
            right.provider.manifest.id,
          )
        );
      });
    const [selected, competing] = candidates;

    if (
      selected &&
      competing &&
      (selected.provider.manifest.selectionPriority ?? 0) ===
        (competing.provider.manifest.selectionPriority ?? 0) &&
      selected.specificity === competing.specificity
    ) {
      throw new AppError('REGISTRATION_CONFLICT');
    }

    if (selected) {
      return { provider: selected.provider, reason: 'matched' };
    }

    return this.fallback(
      mediaCandidates.length > 0
        ? 'missing-capability'
        : 'unsupported-media',
    );
  }

  private validateProvider(provider: MainWorkbenchProvider): void {
    if (!isAssetWorkbenchManifest(provider.manifest)) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }
    if (
      !this.facilityRegistry.validateDeclarations(
        provider.manifest.facilities,
      )
    ) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }
  }
}
