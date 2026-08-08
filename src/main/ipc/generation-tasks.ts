import { BrowserWindow, ipcMain } from 'electron';

import {
  isGenerationTaskIdRequest,
  isGenerationTaskProjectRequest,
  isStartGenerationTaskRequest,
  type GenerationTaskEvent,
  type GenerationTaskView,
} from '../../shared/generation-tasks';
import { IPC_CHANNELS } from '../../shared/ipc';
import { AppError } from '../errors/app-error';
import { generationTaskMetricsToJson } from '../generation/contracts/generation-metrics';
import {
  GenerationTask,
  type GenerationTaskSnapshot,
} from '../generation/generation-task';
import type {
  GenerationTaskServiceApi,
  GenerationTaskServiceEvent,
} from '../generation/generation-task-service';
import { registerIpcHandler } from './register-handler';

let removeSubscription: (() => void) | undefined;

export interface GenerationTaskHandlerDependencies {
  readonly broadcast: (channel: string, value: unknown) => void;
}

const defaultDependencies: GenerationTaskHandlerDependencies = {
  broadcast(channel, value) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, value);
      }
    }
  },
};

function invalidRequest(): Error {
  return new AppError('INVALID_IPC_REQUEST');
}

function toView(snapshot: GenerationTaskSnapshot): GenerationTaskView {
  const status = new GenerationTask(snapshot).getStatus();

  return Object.freeze({
    id: snapshot.id,
    projectId: snapshot.projectId,
    definitionId: snapshot.definitionId,
    definitionVersion: snapshot.definitionVersion,
    status,
    ...(snapshot.assignedProviderId
      ? { assignedProviderId: snapshot.assignedProviderId }
      : {}),
    ...(snapshot.agentCalls.length > 0
      ? { sessionId: snapshot.agentCalls.at(-1)!.sessionId }
      : {}),
    ...(snapshot.completed
      ? { result: snapshot.completed.result }
      : {}),
    metrics: generationTaskMetricsToJson(snapshot.metrics),
    ...(snapshot.failure ? { failure: { ...snapshot.failure } } : {}),
    createdTime: snapshot.createdTime,
    updatedTime: snapshot.updatedTime,
  });
}

function toEvent(event: GenerationTaskServiceEvent): GenerationTaskEvent {
  if (event.type === 'task-changed') {
    return Object.freeze({
      type: event.type,
      snapshot: toView(event.snapshot),
    });
  }

  if (event.type === 'task-completed') {
    return Object.freeze({
      type: event.type,
      snapshot: toView(event.snapshot),
    });
  }

  if (event.type === 'task-discarded') {
    return Object.freeze({ ...event });
  }

  return Object.freeze({
    type: event.type,
    projectId: event.projectId,
    taskId: event.taskId,
    event:
      event.event.type === 'agent-event'
        ? event.event.event
        : event.event,
  });
}

function requireProject(
  service: GenerationTaskServiceApi,
  projectId: string,
): void {
  if (service.getActiveProjectId() !== projectId) {
    throw new AppError('PROJECT_CONTEXT_CHANGED');
  }
}

export function registerGenerationTaskHandlers(
  service: GenerationTaskServiceApi,
  dependencies: GenerationTaskHandlerDependencies = defaultDependencies,
): void {
  removeSubscription?.();
  removeSubscription = service.subscribe((event) => {
    dependencies.broadcast(IPC_CHANNELS.generationTaskChanged, toEvent(event));
  });

  registerIpcHandler(
    IPC_CHANNELS.listGenerationTasks,
    (_event, request: unknown) => {
      if (!isGenerationTaskProjectRequest(request)) {
        throw invalidRequest();
      }

      requireProject(service, request.projectId);
      return service.list().map(toView);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.startGenerationTask,
    (_event, request: unknown) => {
      if (!isStartGenerationTaskRequest(request)) {
        throw invalidRequest();
      }

      requireProject(service, request.projectId);
      return toView(service.start(request));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.retryGenerationTask,
    (_event, request: unknown) => {
      if (!isGenerationTaskIdRequest(request)) {
        throw invalidRequest();
      }

      requireProject(service, request.projectId);
      return toView(service.retry(request.taskId));
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.cancelGenerationTask,
    (_event, request: unknown) => {
      if (!isGenerationTaskIdRequest(request)) {
        throw invalidRequest();
      }

      requireProject(service, request.projectId);
      service.cancel(request.taskId);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.discardGenerationTask,
    (_event, request: unknown) => {
      if (!isGenerationTaskIdRequest(request)) {
        throw invalidRequest();
      }

      requireProject(service, request.projectId);
      service.discard(request.taskId);
    },
  );
}

export function removeGenerationTaskHandlers(): void {
  removeSubscription?.();
  removeSubscription = undefined;
  ipcMain.removeHandler(IPC_CHANNELS.listGenerationTasks);
  ipcMain.removeHandler(IPC_CHANNELS.startGenerationTask);
  ipcMain.removeHandler(IPC_CHANNELS.retryGenerationTask);
  ipcMain.removeHandler(IPC_CHANNELS.cancelGenerationTask);
  ipcMain.removeHandler(IPC_CHANNELS.discardGenerationTask);
}
