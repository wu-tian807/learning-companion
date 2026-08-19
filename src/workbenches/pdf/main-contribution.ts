import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { PdfWorkbenchProvider } from './main';
import { pdfMainFeature } from './main-feature';
import { pdfWorkbenchManifest } from './shared';

export const pdfMainWorkbenchContribution = composeMainWorkbenchContribution(
  pdfWorkbenchManifest,
  (context) =>
    new PdfWorkbenchProvider(
      context.contentResourceService,
      context.stateDatabase,
    ),
  [pdfMainFeature],
);
