import { createContext, useContext } from 'react';
import { useStore } from 'zustand';

import type { WorkbenchRuntime } from './workbench-runtime';
import type { WorkbenchRuntimeState } from './workbench-runtime-store';

export const WorkbenchRuntimeContext = createContext<
  WorkbenchRuntime | undefined
>(undefined);

export function useWorkbenchRuntime(): WorkbenchRuntime {
  const runtime = useContext(WorkbenchRuntimeContext);

  if (!runtime) {
    throw new Error('Workbench Runtime Provider 尚未安装');
  }

  return runtime;
}

export function useWorkbenchRuntimeSelector<T>(
  selector: (state: WorkbenchRuntimeState) => T,
): T {
  const runtime = useWorkbenchRuntime();
  return useStore(runtime.store, selector);
}
