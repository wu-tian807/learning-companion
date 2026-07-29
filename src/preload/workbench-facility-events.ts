import type { IpcRendererEvent } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import {
  createCoreWorkbenchFacilityDefinitionRegistry,
} from '../shared/workbench/facilities/core-facilities';
import type { WorkbenchFacilityDefinitionRegistry } from '../shared/workbench/facilities/facility-definition-registry';
import {
  isKnownWorkbenchFacilityEvent,
  type WorkbenchFacilityEvent,
} from '../shared/workbench/facilities/facility-event';

interface IpcRendererListenerSource {
  on(
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ): unknown;
  removeListener(
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ): unknown;
}

export function subscribeWorkbenchFacilityEvents(
  ipc: IpcRendererListenerSource,
  listener: (event: WorkbenchFacilityEvent) => void,
  facilityRegistry:
    WorkbenchFacilityDefinitionRegistry =
      createCoreWorkbenchFacilityDefinitionRegistry(),
): () => void {
  const wrappedListener = (
    _event: IpcRendererEvent,
    value: unknown,
  ) => {
    if (
      isKnownWorkbenchFacilityEvent(value, facilityRegistry)
    ) {
      listener(value);
    }
  };

  ipc.on(IPC_CHANNELS.workbenchFacilityEvent, wrappedListener);

  return () => {
    ipc.removeListener(
      IPC_CHANNELS.workbenchFacilityEvent,
      wrappedListener,
    );
  };
}
