import { homedir } from 'node:os';

import { resolveCodexHomePath } from '../agents/codex/codex-home-resolver';
import { AssetArtifactDatabase } from '../artifacts/asset-artifact-database';
import { AssetArtifactFileManager } from '../artifacts/asset-artifact-file-manager';
import { AssetArtifactRegistry } from '../artifacts/asset-artifact-registry';
import { AssetArtifactService } from '../artifacts/asset-artifact-service';
import { LibreOfficePreviewProducer } from '../artifacts/producers/libreoffice-preview-producer';
import { AssetDatabase } from '../assets/asset-database';
import { AssetService } from '../assets/asset-service';
import { EmptyAttachmentService } from '../attachments/attachment-service';
import { ContentResolverRegistry } from '../content/content-resolver-registry';
import { ContentResourceService } from '../content/content-resource-service';
import {
  registerContentProtocol,
  removeContentProtocol,
} from '../content/register-content-protocol';
import { LocalFileContentResolver } from '../content/resolvers/local-file/local-file-content-resolver';
import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { createDefaultExternalLibrariesRoot } from '../external-libraries/external-library-path-manager';
import type { ExternalLibraryService } from '../external-libraries/external-library-service';
import { createAppPaths } from '../paths/app-paths';
import { migrateProjectWorkspaces } from '../projects/migrate-project-workspaces';
import { ProjectDatabase } from '../projects/project-database';
import { ProjectService } from '../projects/project-service';
import {
  createDefaultProjectWorkspaceRoot,
  ProjectWorkspaceManager,
} from '../projects/project-workspace-manager';
import { JsonSettingsRepository } from '../settings/json-settings-repository';
import { createCoreWorkbenchFacilityDefinitionRegistry } from '../../shared/workbench/facilities/core-facilities';
import { SandboxContextMenuFacilityAdapter } from '../workbench/interaction/adapters/sandbox-context-menu-facility-adapter';
import { SandboxTextSelectionFacilityAdapter } from '../workbench/interaction/adapters/sandbox-text-selection-facility-adapter';
import { MainFacilityAdapterRegistry } from '../workbench/interaction/main-facility-adapter-registry';
import { SandboxFrameInteractionBridge } from '../workbench/interaction/sandbox-frame-interaction-bridge';
import { WorkbenchTransportBindingRegistry } from '../workbench/interaction/workbench-transport-binding-registry';
import { WorkbenchRegistry } from '../workbench/workbench-registry';
import { WorkbenchSessionManager } from '../workbench/workbench-session-manager';
import { SqliteWorkbenchStateDataRepository } from '../workbench/workbench-state-data-repository';
import { SqliteWorkbenchStateRepository } from '../workbench/workbench-state-repository';
import { registerMainWorkbenches } from '../../workbenches/catalog/register-main-workbenches';
import { UnsupportedWorkbenchProvider } from '../../workbenches/unsupported/main';
import {
  ApplicationRuntime,
} from './application-runtime';
import { createAgentProviderService } from './create-agent-provider-service';
import { createCodexRuntime } from './create-codex-runtime';
import { createExternalLibraryRuntime } from './create-external-library-runtime';
import { registerApplicationIpc } from './register-application-ipc';

export interface CreateApplicationRuntimeInput {
  readonly userDataPath: string;
  readonly documentsPath: string;
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
}

export async function createApplicationRuntime({
  userDataPath,
  documentsPath,
  isPackaged,
  resourcesPath,
}: CreateApplicationRuntimeInput): Promise<ApplicationRuntime> {
  let databaseContext: DatabaseContext | undefined;
  let contentResourceService: ContentResourceService | undefined;
  let externalLibraryService: ExternalLibraryService | undefined;
  let sandboxFrameInteractionBridge:
    | SandboxFrameInteractionBridge
    | undefined;
  let workbenchSessionManager: WorkbenchSessionManager | undefined;
  let disposeIpc: () => void = () => undefined;
  let contentProtocolRegistered = false;

  try {
    const appPaths = createAppPaths(userDataPath);
    const codexHomePath = await resolveCodexHomePath({
      managedCodexHomePath: appPaths.codexHomeDirectory,
      userHomePath: homedir(),
    });
    const codexRuntimeService = createCodexRuntime({
      codexHomePath,
      isPackaged,
      resourcesPath,
    });
    const settingsRepository = new JsonSettingsRepository(
      appPaths.settingsFile,
      {
        defaultProjectWorkspace:
          createDefaultProjectWorkspaceRoot(documentsPath),
        defaultExternalLibrariesPath:
          createDefaultExternalLibrariesRoot(documentsPath),
      },
    );
    await settingsRepository.initialize();
    const agentProviderService = createAgentProviderService(
      settingsRepository,
      codexRuntimeService,
    );
    externalLibraryService = await createExternalLibraryRuntime(
      settingsRepository,
    );
    databaseContext = initializeDatabase(appPaths.databaseFile);
    const workspaceManager = new ProjectWorkspaceManager();
    await migrateProjectWorkspaces(
      databaseContext,
      settingsRepository.getDefaultProjectWorkspace(),
      workspaceManager,
    );
    const projectDatabase = new ProjectDatabase(databaseContext);
    projectDatabase.initialize();
    const artifactRegistry = new AssetArtifactRegistry();
    artifactRegistry.register(
      new LibreOfficePreviewProducer(externalLibraryService),
    );
    const artifactService = new AssetArtifactService(
      new AssetArtifactDatabase(databaseContext),
      new AssetArtifactFileManager(),
      artifactRegistry,
    );
    const assetDatabase = new AssetDatabase(databaseContext);
    const contentResolverRegistry = new ContentResolverRegistry();
    contentResolverRegistry.register(
      new LocalFileContentResolver(workspaceManager),
    );
    contentResourceService = new ContentResourceService();
    registerContentProtocol(contentResourceService);
    contentProtocolRegistered = true;
    const assetService = new AssetService(
      assetDatabase,
      contentResolverRegistry,
      projectDatabase,
      workspaceManager,
      { artifactCleanup: artifactService },
    );
    const workbenchFacilityRegistry =
      createCoreWorkbenchFacilityDefinitionRegistry();
    const transportBindingRegistry =
      new WorkbenchTransportBindingRegistry(
        workbenchFacilityRegistry,
      );
    const mainFacilityAdapterRegistry =
      new MainFacilityAdapterRegistry(workbenchFacilityRegistry);
    mainFacilityAdapterRegistry.register(
      new SandboxContextMenuFacilityAdapter(),
    );
    mainFacilityAdapterRegistry.register(
      new SandboxTextSelectionFacilityAdapter(),
    );
    sandboxFrameInteractionBridge =
      new SandboxFrameInteractionBridge(
        transportBindingRegistry,
        mainFacilityAdapterRegistry,
        workbenchFacilityRegistry,
      );
    const workbenchRegistry = new WorkbenchRegistry(
      new UnsupportedWorkbenchProvider(),
      workbenchFacilityRegistry,
    );
    const workbenchStateRepository =
      new SqliteWorkbenchStateRepository(databaseContext);
    const workbenchStateDataRepository =
      new SqliteWorkbenchStateDataRepository(databaseContext);
    registerMainWorkbenches(workbenchRegistry, {
      artifactService,
      contentResourceService,
      externalLibraryService,
      projectLookup: projectDatabase,
      stateRepository: workbenchStateRepository,
      stateDataRepository: workbenchStateDataRepository,
    });
    workbenchSessionManager = new WorkbenchSessionManager(
      assetService,
      workbenchRegistry,
      new EmptyAttachmentService(),
      workbenchStateRepository,
      { transportBindingRegistry },
    );
    const projectService = new ProjectService(
      projectDatabase,
      assetService,
      workbenchSessionManager,
      workspaceManager,
      settingsRepository,
    );
    disposeIpc = registerApplicationIpc({
      agentProviderService,
      assetService,
      externalLibraryService,
      projectService,
      settingsRepository,
      workbenchSessionManager,
    });

    return new ApplicationRuntime({
      agentProviderService,
      databaseContext,
      codexRuntimeService,
      contentResourceService,
      externalLibraryService,
      sandboxFrameInteractionBridge,
      workbenchSessionManager,
      disposeContentProtocol: removeContentProtocol,
      disposeIpc,
    });
  } catch (error) {
    await Promise.allSettled([
      workbenchSessionManager?.closeActive() ?? Promise.resolve(),
      externalLibraryService?.shutdown() ?? Promise.resolve(),
    ]);
    disposeIpc();
    if (contentProtocolRegistered) {
      removeContentProtocol();
    }
    contentResourceService?.dispose();
    sandboxFrameInteractionBridge?.dispose();
    databaseContext?.close();
    throw error;
  }
}
