import type { AgentProviderServiceApi } from '../agents/agent-provider-service';
import type { AssetServiceApi } from '../assets/asset-service';
import {
  registerAttachmentHandlers,
  removeAttachmentHandlers,
} from '../ipc/attachments';
import type { AttachmentServiceApi } from '../attachments/attachment-service';
import type { ExternalLibraryServiceApi } from '../external-libraries/external-library-service';
import type { GenerationTaskServiceApi } from '../generation/generation-task-service';
import type { GenerationAgentRunnerResolver } from '../generation/generation-agent-runner';
import {
  registerAgentProviderHandlers,
  removeAgentProviderHandlers,
} from '../ipc/agent-providers';
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
  registerGenerationTaskHandlers,
  removeGenerationTaskHandlers,
} from '../ipc/generation-tasks';
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
import type { WorkbenchSessionServiceApi } from '../workbench/workbench-session-service';

export interface ApplicationIpcServices {
  readonly agentProviderService: AgentProviderServiceApi &
    GenerationAgentRunnerResolver;
  readonly assetService: AssetServiceApi;
  readonly attachmentService: AttachmentServiceApi;
  readonly externalLibraryService: ExternalLibraryServiceApi;
  readonly generationTaskService: GenerationTaskServiceApi;
  readonly projectService: ProjectServiceApi;
  readonly settingsRepository: SettingsRepository;
  readonly workbenchSessionService: WorkbenchSessionServiceApi;
}

export interface ApplicationIpcRegistrations {
  readonly registerHealthCheck: () => void;
  readonly removeHealthCheck: () => void;
  readonly registerExternalLink: () => void;
  readonly removeExternalLink: () => void;
  readonly registerAgentProviders: (
    service: AgentProviderServiceApi,
  ) => void;
  readonly removeAgentProviders: () => void;
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
  readonly registerGenerationTasks: (
    service: GenerationTaskServiceApi,
  ) => void;
  readonly removeGenerationTasks: () => void;
  readonly registerAttachments: (
    service: AttachmentServiceApi,
    tasks: GenerationTaskServiceApi,
  ) => void;
  readonly removeAttachments: () => void;
  readonly registerWorkbench: (
    service: WorkbenchSessionServiceApi,
  ) => void;
  readonly removeWorkbench: () => void;
}

const defaultRegistrations: ApplicationIpcRegistrations = {
  registerHealthCheck: registerHealthCheckHandler,
  removeHealthCheck: removeHealthCheckHandler,
  registerExternalLink: registerExternalLinkHandler,
  removeExternalLink: removeExternalLinkHandler,
  registerAgentProviders: registerAgentProviderHandlers,
  removeAgentProviders: removeAgentProviderHandlers,
  registerExternalLibraries: registerExternalLibraryHandlers,
  removeExternalLibraries: removeExternalLibraryHandlers,
  registerSettings: registerSettingsHandlers,
  removeSettings: removeSettingsHandlers,
  registerProjects: registerProjectHandlers,
  removeProjects: removeProjectHandlers,
  registerAssets: registerAssetHandlers,
  removeAssets: removeAssetHandlers,
  registerGenerationTasks: registerGenerationTaskHandlers,
  removeGenerationTasks: removeGenerationTaskHandlers,
  registerAttachments: registerAttachmentHandlers,
  removeAttachments: removeAttachmentHandlers,
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
        registrations.registerAgentProviders(
          services.agentProviderService,
        ),
      registrations.removeAgentProviders,
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
        registrations.registerGenerationTasks(
          services.generationTaskService,
        ),
      registrations.removeGenerationTasks,
    );
    register(
      () =>
        registrations.registerAttachments(
          services.attachmentService,
          services.generationTaskService,
        ),
      registrations.removeAttachments,
    );
    register(
      () =>
        registrations.registerWorkbench(
          services.workbenchSessionService,
        ),
      registrations.removeWorkbench,
    );
  } catch (error) {
    dispose();
    throw error;
  }

  return dispose;
}
