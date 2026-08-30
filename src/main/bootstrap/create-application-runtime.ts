import { homedir } from 'node:os';
import { safeStorage } from 'electron';

import { resolveCodexHomePath } from '../agents/codex/codex-home-resolver';
import { AgentFunctionToolRegistry } from '../agents/function-tools/agent-function-tool-registry';
import { createAgentCapabilityPaths } from '../agents/capabilities/agent-capability-paths';
import { AgentMcpService } from '../agents/mcp/agent-mcp-service';
import { AgentSkillService } from '../agents/skills/agent-skill-service';
import { AgentSessionService } from '../agents/sessions/agent-session-service';
import { EncryptedAgentProviderSecretFile } from '../agents/agent-provider-secret-file';
import { AgentWorkspaceManager } from '../agents/workspaces/agent-workspace-manager';
import { AssetArtifactDatabase } from '../artifacts/asset-artifact-database';
import { AssetArtifactFileManager } from '../artifacts/asset-artifact-file-manager';
import { AssetArtifactRegistry } from '../artifacts/asset-artifact-registry';
import { AssetArtifactService } from '../artifacts/asset-artifact-service';
import { AssetAssociationService } from '../asset-associations/asset-association-service';
import { AssetLinkDatabase } from '../asset-associations/asset-link-database';
import { AssetReferenceDatabase } from '../asset-associations/asset-reference-database';
import { AssetDatabase } from '../assets/asset-database';
import { trackAssetAggregateMutations } from '../assets/asset-aggregate-mutation';
import { AssetFolderDatabase } from '../assets/asset-folder-database';
import { AssetService } from '../assets/asset-service';
import { AttachmentDatabase } from '../attachments/attachment-database';
import { AnchorRegistry } from '../attachments/anchor-registry';
import { AttachmentContentFile } from '../attachments/attachment-content-file';
import { AttachmentRegistry } from '../attachments/attachment-registry';
import { AttachmentService } from '../attachments/attachment-service';
import { ContentResolverRegistry } from '../content/content-resolver-registry';
import { ContentResourceService } from '../content/content-resource-service';
import { WorkbenchConversationContextProviderRegistry } from '../conversation/workbench-conversation-context-provider-registry';
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
import { SandboxFrameInteractionBridge } from '../workbench/interaction/sandbox-frame-interaction-bridge';
import { WorkbenchTransportBindingRegistry } from '../workbench/interaction/workbench-transport-binding-registry';
import { WorkbenchRegistry } from '../workbench/workbench-registry';
import { WorkbenchEventBus } from '../workbench/workbench-event-bus';
import { WorkbenchSessionService } from '../workbench/workbench-session-service';
import { WorkbenchStateDataDatabase } from '../workbench/workbench-state-data-database';
import { WorkbenchStateDatabase } from '../workbench/workbench-state-database';
import {
  registerMainWorkbenchAgentFunctionTools,
  registerMainWorkbenchArtifacts,
  registerMainWorkbenchAttachments,
  registerMainWorkbenchGeneration,
  registerMainWorkbenchProviders,
  startMainWorkbenchContributions,
  type MainWorkbenchRuntime,
} from '../../workbenches/catalog/register-main-workbenches';
import { UnsupportedWorkbenchProvider } from '../../workbenches/unsupported/main';
import { ApplicationRuntime } from './application-runtime';
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
    ReturnType<typeof createAgentProviderService> | undefined;
  let codexRuntimeService: ReturnType<typeof createCodexRuntime> | undefined;
  let sandboxFrameInteractionBridge: SandboxFrameInteractionBridge | undefined;
  let workbenchSessionService: WorkbenchSessionService | undefined;
  let generationTaskService: GenerationTaskService | undefined;
  let mainWorkbenchFeatures: MainWorkbenchRuntime | undefined;
  let disposeAssetAggregateTracking: () => void = () => undefined;
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
    const agentProviderSecrets = new EncryptedAgentProviderSecretFile(
      appPaths.agentProviderSecretsFile,
      safeStorage,
    );
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
    externalLibraryService =
      await createExternalLibraryRuntime(settingsRepository);
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
    registerMainWorkbenchAgentFunctionTools({
      functionTools: agentFunctionTools,
    });
    const agentCapabilityPaths = createAgentCapabilityPaths(documentsPath);
    const agentSkills = new AgentSkillService(agentCapabilityPaths.skillsPath);
    const agentMcpServers = new AgentMcpService(agentCapabilityPaths.mcpPath);
    await Promise.all([agentSkills.initialize(), agentMcpServers.initialize()]);
    agentProviderService = createAgentProviderService(
      settingsRepository,
      agentProviderSecrets,
      codexRuntimeService,
      (environment) =>
        createCodexRuntime({
          codexHomePath,
          isPackaged,
          resourcesPath,
          environment,
        }),
      agentSessionService,
      agentFunctionTools,
      agentSkills,
      agentMcpServers,
    );
    const artifactRegistry = new AssetArtifactRegistry();
    registerMainWorkbenchArtifacts({
      artifacts: artifactRegistry,
      externalLibraries: externalLibraryService,
      externalLibraryProfilesDirectory:
        appPaths.externalLibraryProfilesDirectory,
    });
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
    const attachmentRegistry = new AttachmentRegistry();
    const anchorRegistry = new AnchorRegistry();
    registerMainWorkbenchAttachments({
      attachments: attachmentRegistry,
      anchors: anchorRegistry,
    });
    const attachmentFiles = new AttachmentContentFile(projectDatabase);
    const attachmentService = new AttachmentService(
      new AttachmentDatabase(databaseContext),
      attachmentRegistry,
      anchorRegistry,
      attachmentFiles,
      assetDatabase,
    );
    const assetService = new AssetService(
      assetDatabase,
      new AssetFolderDatabase(databaseContext),
      contentResolverRegistry,
      projectDatabase,
      workspaceManager,
      {
        artifactCleanup: artifactService,
        attachmentCleanup: attachmentService,
        deletionObserver: associationService,
      },
    );
    disposeAssetAggregateTracking = trackAssetAggregateMutations(
      assetService,
      [attachmentService, associationService],
    );
    const workbenchFacilityRegistry =
      createCoreWorkbenchFacilityDefinitionRegistry();
    const transportBindingRegistry = new WorkbenchTransportBindingRegistry(
      workbenchFacilityRegistry,
    );
    sandboxFrameInteractionBridge = new SandboxFrameInteractionBridge(
      transportBindingRegistry,
      workbenchFacilityRegistry,
    );
    const workbenchRegistry = new WorkbenchRegistry(
      new UnsupportedWorkbenchProvider(),
      workbenchFacilityRegistry,
    );
    const workbenchStateRepository = new WorkbenchStateDatabase(
      databaseContext,
    );
    const workbenchStateDataRepository = new WorkbenchStateDataDatabase(
      databaseContext,
    );
    const workbenchEvents = new WorkbenchEventBus();
    const generationTaskDatabase = new GenerationTaskDatabase(databaseContext);
    const generationTaskDefinitions = new GenerationTaskDefinitionRegistry();
    const conversationContexts =
      new WorkbenchConversationContextProviderRegistry();
    registerMainWorkbenchGeneration({
      definitions: generationTaskDefinitions,
      conversationContexts,
      assets: assetService,
      artifacts: artifactService,
      associations: associationService,
      attachments: attachmentService,
      externalLibraries: externalLibraryService,
      projects: projectDatabase,
    });
    const agentWorkspaceManager = new AgentWorkspaceManager(
      appPaths.agentWorkspacesDirectory,
    );
    const generationTaskPreparer = new GenerationTaskPreparer(
      agentWorkspaceManager,
      new GenerationAssetReferencePreparer(assetService, workbenchRegistry),
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
    registerMainWorkbenchProviders(workbenchRegistry, {
      associationService,
      assetService,
      artifactRegistry,
      artifactService,
      contentResourceService,
      externalLibraryService,
      generationTasks: generationTaskService,
      projectLookup: projectDatabase,
      stateDatabase: workbenchStateRepository,
      stateDataDatabase: workbenchStateDataRepository,
      sandboxFrameScripts: sandboxFrameInteractionBridge,
      workbenchEvents,
    });
    workbenchSessionService = new WorkbenchSessionService(
      assetService,
      workbenchRegistry,
      attachmentService,
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
      agentWorkspaceManager,
      settingsRepository,
    );
    disposeIpc = registerApplicationIpc({
      agentProviderService,
      assetService,
      attachmentService,
      externalLibraryService,
      generationTaskService,
      projectService,
      settingsRepository,
      workbenchSessionService,
      workbenchEvents,
    });
    mainWorkbenchFeatures = startMainWorkbenchContributions({
      attachments: attachmentService,
      generationTasks: generationTaskService,
      assets: assetDatabase,
      externalLibraries: externalLibraryService,
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
      shutdownWorkbenchFeatures: () =>
        mainWorkbenchFeatures?.shutdown?.() ?? Promise.resolve(),
      disposeWorkbenchFeatures: () => mainWorkbenchFeatures?.dispose(),
      disposeAssetAggregateTracking,
    });
  } catch (error) {
    disposeAssetAggregateTracking();
    await Promise.allSettled([
      workbenchSessionService?.closeActive() ?? Promise.resolve(),
      Promise.resolve(generationTaskService?.unloadProject()),
      mainWorkbenchFeatures?.shutdown?.() ?? Promise.resolve(),
      externalLibraryService?.shutdown() ?? Promise.resolve(),
      agentProviderService?.dispose() ?? Promise.resolve(),
    ]);
    await codexRuntimeService?.shutdown().catch(() => undefined);
    mainWorkbenchFeatures?.dispose();
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
