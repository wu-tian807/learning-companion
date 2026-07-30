import { libreOfficeDefinition } from '../external-libraries/definitions/libreoffice';
import { ExternalLibraryDownloader } from '../external-libraries/external-library-downloader';
import { ExternalLibraryInstallationStore } from '../external-libraries/external-library-installation-store';
import { ExternalLibraryInstallerRegistry } from '../external-libraries/external-library-installer';
import { ExternalLibraryPathManager } from '../external-libraries/external-library-path-manager';
import { ExternalLibraryRegistry } from '../external-libraries/external-library-registry';
import { ExternalLibraryService } from '../external-libraries/external-library-service';
import { MacosDmgInstaller } from '../external-libraries/installers/macos-dmg-installer';
import { WindowsMsiInstaller } from '../external-libraries/installers/windows-msi-installer';
import type { SettingsRepository } from '../settings/settings-repository';

export async function createExternalLibraryRuntime(
  settingsRepository: SettingsRepository,
): Promise<ExternalLibraryService> {
  const registry = new ExternalLibraryRegistry();
  registry.register(libreOfficeDefinition);
  const installerRegistry = new ExternalLibraryInstallerRegistry();
  installerRegistry.register(new MacosDmgInstaller());
  installerRegistry.register(new WindowsMsiInstaller());
  const service = new ExternalLibraryService(
    settingsRepository,
    registry,
    new ExternalLibraryPathManager(),
    new ExternalLibraryInstallationStore(),
    new ExternalLibraryDownloader(),
    installerRegistry,
  );

  try {
    await service.initialize();
    return service;
  } catch (error) {
    await service.shutdown().catch((shutdownError: unknown) => {
      console.error(
        '外部组件初始化失败后的清理失败',
        shutdownError,
      );
    });
    throw error;
  }
}
