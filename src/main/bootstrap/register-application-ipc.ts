import type { AssetServiceApi } from '../assets/asset-service';
import type { ExternalLibraryServiceApi } from '../external-libraries/external-library-service';
import {
  registerAssetHandlers,
  removeAssetHandlers,
} from '../ipc/assets';
import {
  registerExternalLibraryHandlers,
  removeExternalLibraryHandlers,
} from '../ipc/external-libraries';
import {
  registerExternalLinkHandler,
  removeExternalLinkHandler,
} from '../ipc/external-links';
import {
  registerHealthCheckHandler,
  removeHealthCheckHandler,
} from '../ipc/health-check';
import {
  registerProjectHandlers,
  removeProjectHandlers,
} from '../ipc/projects';
import {
  registerSettingsHandlers,
  removeSettingsHandlers,
} from '../ipc/settings';
import {
  registerWorkbenchHandlers,
  removeWorkbenchHandlers,
} from '../ipc/workbench';
import type { ProjectServiceApi } from '../projects/project-service';
import type { SettingsRepository } from '../settings/settings-repository';
import type { WorkbenchSessionManagerApi } from '../workbench/workbench-session-manager';

export interface ApplicationIpcServices {
  readonly assetService: AssetServiceApi;
  readonly externalLibraryService: ExternalLibraryServiceApi;
  readonly projectService: ProjectServiceApi;
  readonly settingsRepository: SettingsRepository;
  readonly workbenchSessionManager: WorkbenchSessionManagerApi;
}

export interface ApplicationIpcRegistrations {
  readonly registerHealthCheck: () => void;
  readonly removeHealthCheck: () => void;
  readonly registerExternalLink: () => void;
  readonly removeExternalLink: () => void;
  readonly registerExternalLibraries: (
    service: ExternalLibraryServiceApi,
  ) => void;
  readonly removeExternalLibraries: () => void;
  readonly registerSettings: (repository: SettingsRepository) => void;
  readonly removeSettings: () => void;
  readonly registerProjects: (service: ProjectServiceApi) => void;
  readonly removeProjects: () => void;
  readonly registerAssets: (service: AssetServiceApi) => void;
  readonly removeAssets: () => void;
  readonly registerWorkbench: (
    manager: WorkbenchSessionManagerApi,
  ) => void;
  readonly removeWorkbench: () => void;
}

const defaultRegistrations: ApplicationIpcRegistrations = {
  registerHealthCheck: registerHealthCheckHandler,
  removeHealthCheck: removeHealthCheckHandler,
  registerExternalLink: registerExternalLinkHandler,
  removeExternalLink: removeExternalLinkHandler,
  registerExternalLibraries: registerExternalLibraryHandlers,
  removeExternalLibraries: removeExternalLibraryHandlers,
  registerSettings: registerSettingsHandlers,
  removeSettings: removeSettingsHandlers,
  registerProjects: registerProjectHandlers,
  removeProjects: removeProjectHandlers,
  registerAssets: registerAssetHandlers,
  removeAssets: removeAssetHandlers,
  registerWorkbench: registerWorkbenchHandlers,
  removeWorkbench: removeWorkbenchHandlers,
};

export function registerApplicationIpc(
  services: ApplicationIpcServices,
  registrations: ApplicationIpcRegistrations = defaultRegistrations,
): () => void {
  const disposers: Array<() => void> = [];
  let disposed = false;

  const register = (
    setup: () => void,
    dispose: () => void,
  ): void => {
    setup();
    disposers.unshift(dispose);
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    for (const remove of disposers.splice(0)) {
      remove();
    }
  };

  try {
    register(
      registrations.registerHealthCheck,
      registrations.removeHealthCheck,
    );
    register(
      registrations.registerExternalLink,
      registrations.removeExternalLink,
    );
    register(
      () =>
        registrations.registerExternalLibraries(
          services.externalLibraryService,
        ),
      registrations.removeExternalLibraries,
    );
    register(
      () =>
        registrations.registerSettings(services.settingsRepository),
      registrations.removeSettings,
    );
    register(
      () => registrations.registerProjects(services.projectService),
      registrations.removeProjects,
    );
    register(
      () => registrations.registerAssets(services.assetService),
      registrations.removeAssets,
    );
    register(
      () =>
        registrations.registerWorkbench(
          services.workbenchSessionManager,
        ),
      registrations.removeWorkbench,
    );
  } catch (error) {
    dispose();
    throw error;
  }

  return dispose;
}
