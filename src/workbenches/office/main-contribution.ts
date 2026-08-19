import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { OfficeWorkbenchProvider } from './main';
import { officeArtifactMainFeature } from './main-feature';
import { officeWorkbenchManifest } from './shared';

export const officeMainWorkbenchContribution = composeMainWorkbenchContribution(
  officeWorkbenchManifest,
  (context) =>
    new OfficeWorkbenchProvider(
      context.artifactService,
      context.contentResourceService,
      context.externalLibraryService,
      context.projectLookup,
      context.stateDatabase,
    ),
  [officeArtifactMainFeature],
);
