import { app, BrowserWindow } from "electron";
import started from "electron-squirrel-startup";

import type { DatabaseContext } from "./database/database-context";
import { initializeDatabase } from "./database/initialize-database";
import { AssetDatabase } from "./assets/asset-database";
import { AssetService } from "./assets/asset-service";
import { EmptyAttachmentService } from "./attachments/attachment-service";
import {
  createDefaultExternalLibrariesRoot,
  ExternalLibraryPathManager,
} from "./external-libraries/external-library-path-manager";
import { ExternalLibraryDownloader } from "./external-libraries/external-library-downloader";
import { ExternalLibraryInstallationStore } from "./external-libraries/external-library-installation-store";
import { ExternalLibraryInstallerRegistry } from "./external-libraries/external-library-installer";
import { ExternalLibraryRegistry } from "./external-libraries/external-library-registry";
import { ExternalLibraryService } from "./external-libraries/external-library-service";
import { libreOfficeDefinition } from "./external-libraries/definitions/libreoffice";
import { MacosDmgInstaller } from "./external-libraries/installers/macos-dmg-installer";
import { WindowsMsiInstaller } from "./external-libraries/installers/windows-msi-installer";
import { ContentResolverRegistry } from "./content/content-resolver-registry";
import { ContentResourceService } from "./content/content-resource-service";
import {
  registerContentProtocol,
  registerContentSchemePrivileges,
  removeContentProtocol,
} from "./content/register-content-protocol";
import { LocalFileContentResolver } from "./content/resolvers/local-file/local-file-content-resolver";
import {
  registerHealthCheckHandler,
  removeHealthCheckHandler,
} from "./ipc/health-check";
import {
  registerExternalLinkHandler,
  removeExternalLinkHandler,
} from "./ipc/external-links";
import {
  registerExternalLibraryHandlers,
  removeExternalLibraryHandlers,
} from "./ipc/external-libraries";
import { registerAssetHandlers, removeAssetHandlers } from "./ipc/assets";
import { registerProjectHandlers, removeProjectHandlers } from "./ipc/projects";
import {
  registerSettingsHandlers,
  removeSettingsHandlers,
} from "./ipc/settings";
import {
  registerWorkbenchHandlers,
  removeWorkbenchHandlers,
} from "./ipc/workbench";
import { createAppPaths } from "./paths/app-paths";
import { ProjectDatabase } from "./projects/project-database";
import { ProjectService } from "./projects/project-service";
import { migrateProjectWorkspaces } from "./projects/migrate-project-workspaces";
import {
  createDefaultProjectWorkspaceRoot,
  ProjectWorkspaceManager,
} from "./projects/project-workspace-manager";
import { JsonSettingsRepository } from "./settings/json-settings-repository";
import { WorkbenchRegistry } from "./workbench/workbench-registry";
import { WorkbenchSessionManager } from "./workbench/workbench-session-manager";
import { createCoreWorkbenchFacilityDefinitionRegistry } from "../shared/workbench/facilities/core-facilities";
import { MainFacilityAdapterRegistry } from "./workbench/interaction/main-facility-adapter-registry";
import { SandboxContextMenuFacilityAdapter } from "./workbench/interaction/adapters/sandbox-context-menu-facility-adapter";
import { SandboxTextSelectionFacilityAdapter } from "./workbench/interaction/adapters/sandbox-text-selection-facility-adapter";
import { SandboxFrameInteractionBridge } from "./workbench/interaction/sandbox-frame-interaction-bridge";
import { WorkbenchTransportBindingRegistry } from "./workbench/interaction/workbench-transport-binding-registry";
import { SqliteWorkbenchStateDataRepository } from "./workbench/workbench-state-data-repository";
import { SqliteWorkbenchStateRepository } from "./workbench/workbench-state-repository";
import { createMainWindow } from "./window";
import { PlainTextWorkbenchProvider } from "../workbenches/plain-text/main";
import { AudioWorkbenchProvider } from "../workbenches/audio/main";
import { ImageWorkbenchProvider } from "../workbenches/image/main";
import { HtmlWorkbenchProvider } from "../workbenches/html/main";
import { EpubWorkbenchProvider } from "../workbenches/epub/main";
import { MarkdownWorkbenchProvider } from "../workbenches/markdown/main";
import { PdfWorkbenchProvider } from "../workbenches/pdf/main";
import { VideoWorkbenchProvider } from "../workbenches/video/main";
import { UnsupportedWorkbenchProvider } from "../workbenches/unsupported/main";

let databaseContext: DatabaseContext | undefined;
let contentResourceService: ContentResourceService | undefined;
let workbenchSessionManager: WorkbenchSessionManager | undefined;
let externalLibraryService: ExternalLibraryService | undefined;
let sandboxFrameInteractionBridge: SandboxFrameInteractionBridge | undefined;
let workbenchCloseTask: Promise<void> | undefined;
let quitCleanupComplete = false;
let quitCleanupStarted = false;

function closeActiveWorkbench(): Promise<void> {
  if (!workbenchSessionManager) {
    return Promise.resolve();
  }
  if (workbenchCloseTask) {
    return workbenchCloseTask;
  }

  const task = workbenchSessionManager.closeActive();
  const trackedTask = task.finally(() => {
    if (workbenchCloseTask === trackedTask) {
      workbenchCloseTask = undefined;
    }
  });
  workbenchCloseTask = trackedTask;
  return workbenchCloseTask;
}

async function closeApplicationServices(): Promise<void> {
  await Promise.all([
    closeActiveWorkbench(),
    externalLibraryService?.shutdown() ?? Promise.resolve(),
  ]);
}

function createManagedMainWindow(): void {
  const mainWindow = createMainWindow(sandboxFrameInteractionBridge);

  mainWindow.on("closed", () => {
    void closeActiveWorkbench().catch((error: unknown) => {
      console.error("关闭窗口时释放资料工作台失败", error);
    });
  });
}

registerContentSchemePrivileges();

if (started) {
  app.quit();
}

void app
  .whenReady()
  .then(async () => {
    const appPaths = createAppPaths(app.getPath("userData"));
    const settingsRepository = new JsonSettingsRepository(
      appPaths.settingsFile,
      {
        defaultProjectWorkspace: createDefaultProjectWorkspaceRoot(
          app.getPath("documents"),
        ),
        defaultExternalLibrariesPath: createDefaultExternalLibrariesRoot(
          app.getPath("documents"),
        ),
      },
    );
    await settingsRepository.initialize();
    const externalLibraryRegistry = new ExternalLibraryRegistry();
    externalLibraryRegistry.register(libreOfficeDefinition);
    const externalLibraryInstallerRegistry =
      new ExternalLibraryInstallerRegistry();
    externalLibraryInstallerRegistry.register(new MacosDmgInstaller());
    externalLibraryInstallerRegistry.register(new WindowsMsiInstaller());
    externalLibraryService = new ExternalLibraryService(
      settingsRepository,
      externalLibraryRegistry,
      new ExternalLibraryPathManager(),
      new ExternalLibraryInstallationStore(),
      new ExternalLibraryDownloader(),
      externalLibraryInstallerRegistry,
    );
    await externalLibraryService.initialize();
    databaseContext = initializeDatabase(appPaths.databaseFile);
    const workspaceManager = new ProjectWorkspaceManager();
    await migrateProjectWorkspaces(
      databaseContext,
      settingsRepository.getDefaultProjectWorkspace(),
      workspaceManager,
    );
    const projectDatabase = new ProjectDatabase(databaseContext);
    projectDatabase.initialize();
    const assetDatabase = new AssetDatabase(databaseContext, projectDatabase);
    const contentResolverRegistry = new ContentResolverRegistry();
    contentResolverRegistry.register(
      new LocalFileContentResolver(workspaceManager),
    );
    contentResourceService = new ContentResourceService();
    registerContentProtocol(contentResourceService);
    const assetService = new AssetService(
      assetDatabase,
      contentResolverRegistry,
      projectDatabase,
      workspaceManager,
    );
    const workbenchFacilityRegistry =
      createCoreWorkbenchFacilityDefinitionRegistry();
    const transportBindingRegistry = new WorkbenchTransportBindingRegistry(
      workbenchFacilityRegistry,
    );
    const mainFacilityAdapterRegistry = new MainFacilityAdapterRegistry(
      workbenchFacilityRegistry,
    );
    mainFacilityAdapterRegistry.register(
      new SandboxContextMenuFacilityAdapter(),
    );
    mainFacilityAdapterRegistry.register(
      new SandboxTextSelectionFacilityAdapter(),
    );
    sandboxFrameInteractionBridge = new SandboxFrameInteractionBridge(
      transportBindingRegistry,
      mainFacilityAdapterRegistry,
      workbenchFacilityRegistry,
    );
    const workbenchRegistry = new WorkbenchRegistry(
      new UnsupportedWorkbenchProvider(),
      workbenchFacilityRegistry,
    );
    const workbenchStateRepository = new SqliteWorkbenchStateRepository(
      databaseContext,
    );
    const workbenchStateDataRepository = new SqliteWorkbenchStateDataRepository(
      databaseContext,
    );
    workbenchRegistry.register(
      new PlainTextWorkbenchProvider(
        workbenchStateRepository,
        workbenchStateDataRepository,
      ),
    );
    workbenchRegistry.register(
      new AudioWorkbenchProvider(
        contentResourceService,
        workbenchStateRepository,
      ),
    );
    workbenchRegistry.register(
      new ImageWorkbenchProvider(
        contentResourceService,
        workbenchStateRepository,
      ),
    );
    workbenchRegistry.register(
      new HtmlWorkbenchProvider(contentResourceService),
    );
    workbenchRegistry.register(
      new EpubWorkbenchProvider(
        contentResourceService,
        workbenchStateRepository,
      ),
    );
    workbenchRegistry.register(
      new MarkdownWorkbenchProvider(
        workbenchStateRepository,
        workbenchStateDataRepository,
      ),
    );
    workbenchRegistry.register(
      new PdfWorkbenchProvider(
        contentResourceService,
        workbenchStateRepository,
      ),
    );
    workbenchRegistry.register(
      new VideoWorkbenchProvider(
        contentResourceService,
        workbenchStateRepository,
      ),
    );
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

    registerHealthCheckHandler();
    registerExternalLinkHandler();
    registerExternalLibraryHandlers(externalLibraryService);
    registerSettingsHandlers(settingsRepository);
    registerProjectHandlers(projectService);
    registerAssetHandlers(assetService);
    registerWorkbenchHandlers(workbenchSessionManager);
    createManagedMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createManagedMainWindow();
      }
    });
  })
  .catch(async (error: unknown) => {
    console.error("应用初始化失败", error);
    await closeApplicationServices().catch((closeError: unknown) => {
      console.error("初始化失败后的应用服务清理失败", closeError);
    });
    workbenchSessionManager = undefined;
    externalLibraryService = undefined;
    sandboxFrameInteractionBridge?.dispose();
    sandboxFrameInteractionBridge = undefined;
    databaseContext?.close();
    databaseContext = undefined;
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitCleanupComplete || quitCleanupStarted) {
    return;
  }

  event.preventDefault();
  quitCleanupStarted = true;
  void closeApplicationServices()
    .catch((error: unknown) => {
      console.error("应用退出前清理服务失败", error);
    })
    .finally(() => {
      quitCleanupComplete = true;
      quitCleanupStarted = false;
      app.quit();
    });
});

app.on("will-quit", () => {
  removeContentProtocol();
  contentResourceService?.dispose();
  contentResourceService = undefined;
  removeHealthCheckHandler();
  removeExternalLinkHandler();
  removeExternalLibraryHandlers();
  removeAssetHandlers();
  removeWorkbenchHandlers();
  removeSettingsHandlers();
  removeProjectHandlers();
  sandboxFrameInteractionBridge?.dispose();
  sandboxFrameInteractionBridge = undefined;
  workbenchSessionManager = undefined;
  externalLibraryService = undefined;
  databaseContext?.close();
  databaseContext = undefined;
});
