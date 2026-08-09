import type { AssetArtifactServiceApi } from '../../main/artifacts/asset-artifact-service';
import type { AssetAssociationServiceApi } from '../../main/asset-associations/asset-association-service';
import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import type { ExternalLibraryServiceApi } from '../../main/external-libraries/external-library-service';
import type { ProjectLookup } from '../../main/projects/project-database';
import type { MainFacilityAdapterRegistry } from '../../main/workbench/interaction/main-facility-adapter-registry';
import type { WorkbenchRegistry } from '../../main/workbench/workbench-registry';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type { WorkbenchStateDataDatabaseApi } from '../../main/workbench/workbench-state-data-database';
import type { WorkbenchStateDatabaseApi } from '../../main/workbench/workbench-state-database';
import { areAssetWorkbenchManifestsEqual } from '../../shared/workbench/manifest';
import { AudioWorkbenchProvider } from '../audio/main';
import { EpubWorkbenchProvider } from '../epub/main';
import { HtmlWorkbenchProvider } from '../html/main';
import { ImageWorkbenchProvider } from '../image/main';
import { MarkdownWorkbenchProvider } from '../markdown/main';
import { MindMapWorkbenchProvider } from '../mindmap/main';
import { OfficeWorkbenchProvider } from '../office/main';
import { PdfWorkbenchProvider } from '../pdf/main';
import { PlainTextWorkbenchProvider } from '../plain-text/main';
import { VideoWorkbenchProvider } from '../video/main';
import {
  builtinWorkbenchCatalog,
  type BuiltinWorkbenchId,
} from './builtin-workbenches';

export interface MainWorkbenchRegistrationDependencies {
  readonly associationService: AssetAssociationServiceApi;
  readonly artifactService: AssetArtifactServiceApi;
  readonly contentResourceService: ContentResourceServiceApi;
  readonly externalLibraryService: ExternalLibraryServiceApi;
  readonly facilityAdapterRegistry: MainFacilityAdapterRegistry;
  readonly projectLookup: ProjectLookup;
  readonly stateDatabase: WorkbenchStateDatabaseApi;
  readonly stateDataDatabase: WorkbenchStateDataDatabaseApi;
}

type MainWorkbenchProviderFactory<TId extends BuiltinWorkbenchId> = (
  dependencies: MainWorkbenchRegistrationDependencies,
) => MainWorkbenchProvider<TId>;

const providerFactories: Readonly<
  {
    [TId in BuiltinWorkbenchId]: MainWorkbenchProviderFactory<TId>;
  }
> = {
  'builtin.plain-text': (dependencies) =>
    new PlainTextWorkbenchProvider(
      dependencies.stateDatabase,
      dependencies.stateDataDatabase,
    ),
  'builtin.markdown': (dependencies) =>
    new MarkdownWorkbenchProvider(
      dependencies.stateDatabase,
      dependencies.stateDataDatabase,
    ),
  'builtin.mindmap': (dependencies) =>
    new MindMapWorkbenchProvider(
      dependencies.stateDatabase,
      dependencies.associationService,
    ),
  'builtin.pdf': (dependencies) =>
    new PdfWorkbenchProvider(
      dependencies.contentResourceService,
      dependencies.stateDatabase,
    ),
  'builtin.office': (dependencies) =>
    new OfficeWorkbenchProvider(
      dependencies.artifactService,
      dependencies.contentResourceService,
      dependencies.externalLibraryService,
      dependencies.projectLookup,
      dependencies.stateDatabase,
    ),
  'builtin.html': (dependencies) =>
    new HtmlWorkbenchProvider(
      dependencies.contentResourceService,
      dependencies.stateDataDatabase,
    ),
  'builtin.epub': (dependencies) =>
    new EpubWorkbenchProvider(
      dependencies.contentResourceService,
      dependencies.stateDatabase,
    ),
  'builtin.image': (dependencies) =>
    new ImageWorkbenchProvider(
      dependencies.contentResourceService,
      dependencies.stateDatabase,
    ),
  'builtin.audio': (dependencies) =>
    new AudioWorkbenchProvider(
      dependencies.contentResourceService,
      dependencies.stateDatabase,
    ),
  'builtin.video': (dependencies) =>
    new VideoWorkbenchProvider(
      dependencies.contentResourceService,
      dependencies.stateDatabase,
    ),
};

export function registerMainWorkbenches(
  registry: WorkbenchRegistry,
  dependencies: MainWorkbenchRegistrationDependencies,
): void {
  for (const entry of builtinWorkbenchCatalog) {
    const provider = providerFactories[entry.id](dependencies);

    if (
      !areAssetWorkbenchManifestsEqual(
        provider.manifest,
        entry.manifest,
      )
    ) {
      throw new Error(
        `Main Workbench 注册契约不匹配：${entry.id}`,
      );
    }

    registry.register(provider);

    for (const adapter of provider.facilityAdapters ?? []) {
      if (adapter.workbenchId !== provider.manifest.id) {
        throw new Error(
          `Main Workbench Facility Adapter 归属不匹配：${entry.id}`,
        );
      }

      dependencies.facilityAdapterRegistry.register(adapter);
    }
  }
}
