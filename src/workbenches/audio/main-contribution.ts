import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { AudioWorkbenchProvider } from './main';
import { audioWorkbenchManifest } from './shared';

export const audioMainWorkbenchContribution = composeMainWorkbenchContribution(
  audioWorkbenchManifest,
  (context) =>
    new AudioWorkbenchProvider(
      context.contentResourceService,
      context.stateDatabase,
    ),
);
