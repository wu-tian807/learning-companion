import type { AssetArtifactServiceApi } from '../../main/artifacts/asset-artifact-service';
import type { ContentResourceServiceApi } from '../../main/content/content-resource-service';
import type { ExternalLibraryServiceApi } from '../../main/external-libraries/external-library-service';
import type { ProjectLookup } from '../../main/projects/project-database';
import type { WorkbenchRegistry } from '../../main/workbench/workbench-registry';
import type { MainWorkbenchProvider } from '../../main/workbench/workbench-session';
import type { WorkbenchStateDataRepository } from '../../main/workbench/workbench-state-data-repository';
import type { WorkbenchStateRepository } from '../../main/workbench/workbench-state-repository';
import { AudioWorkbenchProvider } from '../audio/main';
import { EpubWorkbenchProvider } from '../epub/main';
import { HtmlWorkbenchProvider } from '../html/main';
import { ImageWorkbenchProvider } from '../image/main';
import { MarkdownWorkbenchProvider } from '../markdown/main';
import { OfficeWorkbenchProvider } from '../office/main';
import { PdfWorkbenchProvider } from '../pdf/main';
import { PlainTextWorkbenchProvider } from '../plain-text/main';
import { VideoWorkbenchProvider } from '../video/main';
import {
  builtinWorkbenchCatalog,
  type BuiltinWorkbenchId,
} from './builtin-workbenches';

export interface MainWorkbenchRegistrationDependencies {
  readonly artifactService: AssetArtifactServiceApi;
  readonly contentResourceService: ContentResourceServiceApi;
  readonly externalLibraryService: ExternalLibraryServiceApi;
  readonly projectLookup: ProjectLookup;
  readonly stateRepository: WorkbenchStateRepository;
  readonly stateDataRepository: WorkbenchStateDataRepository;
}

type MainWorkbenchProviderFactory = (
  dependencies: MainWorkbenchRegistrationDependencies,
) => MainWorkbenchProvider;

const providerFactories: Readonly<
  Record<BuiltinWorkbenchId, MainWorkbenchProviderFactory>
> = {
  'builtin.plain-text': (dependencies) =>
    new PlainTextWorkbenchProvider(
      dependencies.stateRepository,
      dependencies.stateDataRepository,
    ),
  'builtin.markdown': (dependencies) =>
    new MarkdownWorkbenchProvider(
      dependencies.stateRepository,
      dependencies.stateDataRepository,
    ),
  'builtin.pdf': (dependencies) =>
    new PdfWorkbenchProvider(
      dependencies.contentResourceService,
      dependencies.stateRepository,
    ),
  'builtin.office': (dependencies) =>
    new OfficeWorkbenchProvider(
      dependencies.artifactService,
      dependencies.contentResourceService,
      dependencies.externalLibraryService,
      dependencies.projectLookup,
      dependencies.stateRepository,
    ),
  'builtin.html': (dependencies) =>
    new HtmlWorkbenchProvider(dependencies.contentResourceService),
  'builtin.epub': (dependencies) =>
    new EpubWorkbenchProvider(
      dependencies.contentResourceService,
      dependencies.stateRepository,
    ),
  'builtin.image': (dependencies) =>
    new ImageWorkbenchProvider(
      dependencies.contentResourceService,
      dependencies.stateRepository,
    ),
  'builtin.audio': (dependencies) =>
    new AudioWorkbenchProvider(
      dependencies.contentResourceService,
      dependencies.stateRepository,
    ),
  'builtin.video': (dependencies) =>
    new VideoWorkbenchProvider(
      dependencies.contentResourceService,
      dependencies.stateRepository,
    ),
};

export function registerMainWorkbenches(
  registry: WorkbenchRegistry,
  dependencies: MainWorkbenchRegistrationDependencies,
): void {
  for (const entry of builtinWorkbenchCatalog) {
    const provider = providerFactories[entry.id](dependencies);

    if (provider.manifest.id !== entry.id) {
      throw new Error(
        `Main Workbench 注册结果不匹配：${entry.id}`,
      );
    }

    registry.register(provider);
  }
}
