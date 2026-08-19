import {
  isWorkbenchEvent,
  type WorkbenchEvent,
} from '../../shared/workbench/protocol';
import { AppError } from '../errors/app-error';

export type WorkbenchEventListener = (event: WorkbenchEvent) => void;

export interface WorkbenchEventBusApi {
  publish(event: WorkbenchEvent): void;
  subscribe(listener: WorkbenchEventListener): () => void;
}

export class WorkbenchEventBus implements WorkbenchEventBusApi {
  private readonly listeners = new Set<WorkbenchEventListener>();

  publish(event: WorkbenchEvent): void {
    if (!isWorkbenchEvent(event)) {
      throw new AppError('DATA_INTEGRITY_ERROR');
    }

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: WorkbenchEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
