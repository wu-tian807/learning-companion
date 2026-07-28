import type { WorkbenchInvocationContext } from '../../../shared/workbench/interaction';

export type WorkbenchActionClosePolicy =
  | 'always'
  | 'on-success'
  | 'never';

export interface WorkbenchAction {
  readonly id: string;
  readonly enabled: boolean;
  readonly execute: (
    context: WorkbenchInvocationContext,
  ) => Promise<void> | void;
}

export interface WorkbenchActionBundle {
  readonly actions: readonly WorkbenchAction[];
  readonly contributions: readonly import('./workbench-contribution').WorkbenchContribution[];
}
