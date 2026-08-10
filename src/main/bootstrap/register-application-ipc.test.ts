import { describe, expect, it, vi } from 'vitest';

import {
  registerApplicationIpc,
  type ApplicationIpcRegistrations,
  type ApplicationIpcServices,
} from './register-application-ipc';

function createRegistrations(): ApplicationIpcRegistrations {
  return {
    registerHealthCheck: vi.fn(),
    removeHealthCheck: vi.fn(),
    registerExternalLink: vi.fn(),
    removeExternalLink: vi.fn(),
    registerAgentProviders: vi.fn(),
    removeAgentProviders: vi.fn(),
    registerExternalLibraries: vi.fn(),
    removeExternalLibraries: vi.fn(),
    registerSettings: vi.fn(),
    removeSettings: vi.fn(),
    registerProjects: vi.fn(),
    removeProjects: vi.fn(),
    registerAssets: vi.fn(),
    removeAssets: vi.fn(),
    registerGenerationTasks: vi.fn(),
    removeGenerationTasks: vi.fn(),
    registerEpubExplanations: vi.fn(),
    removeEpubExplanations: vi.fn(),
    registerWorkbench: vi.fn(),
    removeWorkbench: vi.fn(),
  };
}

const services: ApplicationIpcServices = {
  agentProviderService: {} as never,
  assetService: {} as never,
  externalLibraryService: {} as never,
      generationTaskService: {} as never,
      epubExplanationService: {} as never,
  projectService: {} as never,
  settingsRepository: {} as never,
  workbenchSessionService: {} as never,
};

describe('registerApplicationIpc', () => {
  it('registers all handlers and disposes them in reverse order', () => {
    const registrations = createRegistrations();
    const dispose = registerApplicationIpc(services, registrations);

    expect(
      registrations.registerExternalLibraries,
    ).toHaveBeenCalledWith(services.externalLibraryService);
    expect(registrations.registerAgentProviders).toHaveBeenCalledWith(
      services.agentProviderService,
    );
    expect(registrations.registerSettings).toHaveBeenCalledWith(
      services.settingsRepository,
    );
    expect(registrations.registerProjects).toHaveBeenCalledWith(
      services.projectService,
    );
    expect(registrations.registerAssets).toHaveBeenCalledWith(
      services.assetService,
    );
    expect(registrations.registerGenerationTasks).toHaveBeenCalledWith(
      services.generationTaskService,
    );
    expect(registrations.registerWorkbench).toHaveBeenCalledWith(
      services.workbenchSessionService,
    );

    dispose();
    dispose();

    const removals = [
      registrations.removeWorkbench,
      registrations.removeGenerationTasks,
      registrations.removeAssets,
      registrations.removeProjects,
      registrations.removeSettings,
      registrations.removeExternalLibraries,
      registrations.removeAgentProviders,
      registrations.removeExternalLink,
      registrations.removeHealthCheck,
    ];

    for (const [index, removal] of removals.entries()) {
      const removalMock = vi.mocked(removal);
      expect(removalMock).toHaveBeenCalledOnce();
      if (index > 0) {
        expect(removalMock).toHaveBeenCalledAfter(
          vi.mocked(removals[index - 1]),
        );
      }
    }
  });

  it('removes earlier handlers when registration fails', () => {
    const registrations = createRegistrations();
    vi.mocked(registrations.registerSettings).mockImplementation(() => {
      throw new Error('registration failed');
    });

    expect(() =>
      registerApplicationIpc(services, registrations),
    ).toThrow('registration failed');
    expect(
      registrations.removeExternalLibraries,
    ).toHaveBeenCalledOnce();
    expect(registrations.removeAgentProviders).toHaveBeenCalledOnce();
    expect(registrations.removeExternalLink).toHaveBeenCalledOnce();
    expect(registrations.removeHealthCheck).toHaveBeenCalledOnce();
    expect(registrations.removeSettings).not.toHaveBeenCalled();
  });
});
