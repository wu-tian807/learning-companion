import {
  isAssetWorkbenchManifest,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
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

function matchesMediaType(
  manifest: AssetWorkbenchManifest,
  mediaType: string,
): boolean {
  const [type] = mediaType.split('/');

  return manifest.supportedMediaTypes.some(
    (supported) =>
      supported === mediaType ||
      supported === '*/*' ||
      supported === `${type}/*`,
  );
}

export class WorkbenchRegistry {
  private readonly providers = new Map<string, MainWorkbenchProvider>();

  constructor(private readonly fallbackProvider: MainWorkbenchProvider) {
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
    const candidates = [...this.providers.values()].filter(
      (provider) =>
        provider !== this.fallbackProvider &&
        matchesMediaType(provider.manifest, mediaType),
    );
    const provider = candidates.find(
      (candidate) =>
        handle !== undefined &&
        hasContentCapabilities(
          handle,
          candidate.manifest.requiredContentCapabilities,
        ),
    );

    if (provider) {
      return { provider, reason: 'matched' };
    }

    return this.fallback(
      candidates.length > 0 ? 'missing-capability' : 'unsupported-media',
    );
  }

  private validateProvider(provider: MainWorkbenchProvider): void {
    if (!isAssetWorkbenchManifest(provider.manifest)) {
      throw new AppError('INVALID_EXTENSION_DEFINITION');
    }
  }
}
