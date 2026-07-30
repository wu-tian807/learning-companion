import type { WorkbenchAction } from './workbench-action';
import type { WorkbenchContribution } from './workbench-contribution';

export interface WorkbenchActionBundle {
  readonly actions: readonly WorkbenchAction[];
  readonly contributions: readonly WorkbenchContribution[];
}
