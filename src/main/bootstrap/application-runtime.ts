import type { DatabaseContext } from '../database/database-context';
import type { ContentResourceService } from '../content/content-resource-service';
import type { AgentProviderServiceApi } from '../agents/agent-provider-service';
import type { CodexRuntimeServiceApi } from '../agents/codex/codex-runtime-service';
import type { ExternalLibraryServiceApi } from '../external-libraries/external-library-service';
import type { SandboxFrameInteractionBridge } from '../workbench/interaction/sandbox-frame-interaction-bridge';
import type { WorkbenchSessionServiceApi } from '../workbench/workbench-session-service';

export interface ApplicationRuntimeResources {
  readonly databaseContext: DatabaseContext;
  readonly agentProviderService: AgentProviderServiceApi;
  readonly codexRuntimeService: CodexRuntimeServiceApi;
  readonly contentResourceService: ContentResourceService;
  readonly externalLibraryService: ExternalLibraryServiceApi;
  readonly sandboxFrameInteractionBridge: SandboxFrameInteractionBridge;
  readonly workbenchSessionService: WorkbenchSessionServiceApi;
  readonly disposeContentProtocol: () => void;
  readonly disposeIpc: () => void;
}

export class ApplicationRuntime {
  private workbenchCloseTask: Promise<void> | undefined;
  private shutdownTask: Promise<void> | undefined;
  private disposed = false;

  constructor(
    private readonly resources: ApplicationRuntimeResources,
  ) {}

  get interactionBridge(): SandboxFrameInteractionBridge {
    return this.resources.sandboxFrameInteractionBridge;
  }

  get codexRuntime(): CodexRuntimeServiceApi {
    return this.resources.codexRuntimeService;
  }

  get agentProviders(): AgentProviderServiceApi {
    return this.resources.agentProviderService;
  }

  closeActiveWorkbench(): Promise<void> {
    if (this.workbenchCloseTask) {
      return this.workbenchCloseTask;
    }

    const task = this.resources.workbenchSessionService.closeActive();
    const trackedTask = task.finally(() => {
      if (this.workbenchCloseTask === trackedTask) {
        this.workbenchCloseTask = undefined;
      }
    });
    this.workbenchCloseTask = trackedTask;
    return trackedTask;
  }

  shutdown(): Promise<void> {
    if (this.shutdownTask) {
      return this.shutdownTask;
    }

    const providerShutdown = this.resources.agentProviderService
      .dispose()
      .then(() => this.resources.codexRuntimeService.shutdown());
    this.shutdownTask = Promise.all([
      this.closeActiveWorkbench(),
      providerShutdown,
      this.resources.externalLibraryService.shutdown(),
    ]).then(() => undefined);
    return this.shutdownTask;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.resources.disposeContentProtocol();
    this.resources.contentResourceService.dispose();
    this.resources.disposeIpc();
    this.resources.sandboxFrameInteractionBridge.dispose();
    this.resources.databaseContext.close();
  }
}
