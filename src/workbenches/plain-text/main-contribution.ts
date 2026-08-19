import { composeMainWorkbenchContribution } from '../../main/workbench/main-workbench-contribution';
import { PlainTextWorkbenchProvider } from './main';
import { plainTextWorkbenchManifest } from './shared';

export const plainTextMainWorkbenchContribution =
  composeMainWorkbenchContribution(plainTextWorkbenchManifest, (context) =>
    new PlainTextWorkbenchProvider(
      context.stateDatabase,
      context.stateDataDatabase,
    ));
