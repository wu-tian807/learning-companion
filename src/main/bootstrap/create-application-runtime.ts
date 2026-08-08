import { homedir } from 'node:os';

import { resolveCodexHomePath } from '../agents/codex/codex-home-resolver';
import { AgentFunctionToolRegistry } from '../agents/function-tools/agent-function-tool-registry';
import { createAgentCapabilityPaths } from '../agents/capabilities/agent-capability-paths';
import { AgentMcpService } from '../agents/mcp/agent-mcp-service';
import { AgentSkillService } from '../agents/skills/agent-skill-service';
import { AgentSessionService } from '../agents/sessions/agent-session-service';
import { AgentWorkspaceManager } from '../agents/workspaces/agent-workspace-manager';
import { AssetArtifactDatabase } from '../artifacts/asset-artifact-database';
import { AssetArtifactFileManager } from '../artifacts/asset-artifact-file-manager';
import { AssetArtifactRegistry } from '../artifacts/asset-artifact-registry';
import { AssetArtifactService } from '../artifacts/asset-artifact-service';
import { AssetAssociationService } from '../asset-associations/asset-association-service';
import { AssetLinkDatabase } from '../asset-associations/asset-link-database';
import { AssetReferenceDatabase } from '../asset-associations/asset-reference-database';
import { LibreOfficePreviewProducer } from '../../workbenches/office/artifacts/libreoffice-preview-producer';
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
import { GenerationAgentExecutor } from '../generation/generation-agent-executor';
import { GenerationTaskDatabase } from '../generation/generation-task-database';
import { GenerationTaskDefinitionRegistry } from '../generation/generation-task-definition-registry';
import { GenerationTaskExecution } from '../generation/generation-task-execution';
import { GenerationTaskService } from '../generation/generation-task-service';
import { GenerationAssetReferencePreparer } from '../generation/preparation/generation-asset-reference-preparer';
import { GenerationPreparedManifestFile } from '../generation/preparation/generation-prepared-manifest-file';
import { GenerationTaskPreparer } from '../generation/preparation/generation-task-preparer';
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
import { WorkbenchSessionService } from '../workbench/workbench-session-service';
import { WorkbenchStateDataDatabase } from '../workbench/workbench-state-data-database';
import { WorkbenchStateDatabase } from '../workbench/workbench-state-database';
import { registerMainWorkbenches } from '../../workbenches/catalog/register-main-workbenches';
import { registerWorkbenchAgentFunctionTools } from '../../workbenches/catalog/register-agent-function-tools';
import { MindMapGenerationProcessor } from '../../workbenches/mindmap/generation/mindmap-generation-processor';
import { createMindMapGenerationTaskDefinitionV1 } from '../../workbenches/mindmap/generation/mindmap-generation-task-definition';
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
  let agentProviderService:
    | ReturnType<typeof createAgentProviderService>
    | undefined;
  let codexRuntimeService:
    | ReturnType<typeof createCodexRuntime>
    | undefined;
  let sandboxFrameInteractionBridge:
    | SandboxFrameInteractionBridge
    | undefined;
  let workbenchSessionService: WorkbenchSessionService | undefined;
  let generationTaskService: GenerationTaskService | undefined;
  let disposeIpc: () => void = () => undefined;
  let contentProtocolRegistered = false;

  try {
    const appPaths = createAppPaths(userDataPath);
    const codexHomePath = await resolveCodexHomePath({
      managedCodexHomePath: appPaths.codexHomeDirectory,
      userHomePath: homedir(),
    });
    codexRuntimeService = createCodexRuntime({
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
    const agentSessionService = new AgentSessionService(projectDatabase);
    const agentFunctionTools = new AgentFunctionToolRegistry();
    const agentToolRegistration =
      registerWorkbenchAgentFunctionTools(agentFunctionTools);
    const agentCapabilityPaths = createAgentCapabilityPaths(documentsPath);
    const agentSkills = new AgentSkillService(
      agentCapabilityPaths.skillsPath,
    );
    const agentMcpServers = new AgentMcpService(
      agentCapabilityPaths.mcpPath,
    );
    await Promise.all([
      agentSkills.initialize(),
      agentMcpServers.initialize(),
    ]);
    agentProviderService = createAgentProviderService(
      settingsRepository,
      codexRuntimeService,
      agentSessionService,
      agentFunctionTools,
      agentSkills,
      agentMcpServers,
      agentToolRegistration.defaultToolRequirements,
    );
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
    const associationService = new AssetAssociationService(
      new AssetReferenceDatabase(databaseContext),
      new AssetLinkDatabase(databaseContext),
      projectDatabase,
      assetDatabase,
    );
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
      {
        artifactCleanup: artifactService,
        deletionObserver: associationService,
      },
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
      new WorkbenchStateDatabase(databaseContext);
    const workbenchStateDataRepository =
      new WorkbenchStateDataDatabase(databaseContext);
    registerMainWorkbenches(workbenchRegistry, {
      associationService,
      artifactService,
      contentResourceService,
      externalLibraryService,
      projectLookup: projectDatabase,
      stateDatabase: workbenchStateRepository,
      stateDataDatabase: workbenchStateDataRepository,
    });
    const generationTaskDatabase = new GenerationTaskDatabase(
      databaseContext,
    );
    const generationTaskDefinitions =
      new GenerationTaskDefinitionRegistry();
    generationTaskDefinitions.register(
      createMindMapGenerationTaskDefinitionV1(
        new MindMapGenerationProcessor(
          assetService,
          associationService,
        ),
      ),
    );
    const generationTaskPreparer = new GenerationTaskPreparer(
      new AgentWorkspaceManager(appPaths.agentWorkspacesDirectory),
      new GenerationAssetReferencePreparer(
        assetService,
        workbenchRegistry,
      ),
      new GenerationPreparedManifestFile(),
    );
    generationTaskService = new GenerationTaskService(
      generationTaskDatabase,
      generationTaskDefinitions,
      new GenerationTaskExecution(
        generationTaskDatabase,
        generationTaskPreparer,
        new GenerationAgentExecutor(),
      ),
      projectDatabase,
      agentProviderService,
    );
    workbenchSessionService = new WorkbenchSessionService(
      assetService,
      workbenchRegistry,
      new EmptyAttachmentService(),
      workbenchStateRepository,
      { transportBindingRegistry },
    );
    const projectService = new ProjectService(
      projectDatabase,
      assetService,
      associationService,
      agentSessionService,
      generationTaskService,
      workbenchSessionService,
      workspaceManager,
      settingsRepository,
    );
    disposeIpc = registerApplicationIpc({
      agentProviderService,
      assetService,
      externalLibraryService,
      generationTaskService,
      projectService,
      settingsRepository,
      workbenchSessionService,
    });

    return new ApplicationRuntime({
      agentProviderService,
      databaseContext,
      codexRuntimeService,
      contentResourceService,
      externalLibraryService,
      generationTaskService,
      sandboxFrameInteractionBridge,
      workbenchSessionService,
      disposeContentProtocol: removeContentProtocol,
      disposeIpc,
    });
  } catch (error) {
    await Promise.allSettled([
      workbenchSessionService?.closeActive() ?? Promise.resolve(),
      Promise.resolve(generationTaskService?.unloadProject()),
      externalLibraryService?.shutdown() ?? Promise.resolve(),
      agentProviderService?.dispose() ?? Promise.resolve(),
    ]);
    await codexRuntimeService?.shutdown().catch(() => undefined);
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
