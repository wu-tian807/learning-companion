import type { IpcRenderer, IpcRendererEvent } from 'electron';

import type { WorkbenchFeatureIpcInvoke } from '../../../preload/workbench-preload-contribution';
import {
  VIDEO_EXPLANATION_IPC_CHANNELS,
  isVideoExplanationEvent,
  type VideoExplanationPreloadApi,
  type VideoExplanationView,
} from './shared';

export function createVideoExplanationPreloadApi(
  ipcRenderer: IpcRenderer,
  invoke: WorkbenchFeatureIpcInvoke,
): VideoExplanationPreloadApi {
  return Object.freeze({
    listVideoExplanations: (request) =>
      invoke<VideoExplanationView[]>(
        VIDEO_EXPLANATION_IPC_CHANNELS.list,
        request,
      ),
    retryVideoExplanation: (request) =>
      invoke<VideoExplanationView>(
        VIDEO_EXPLANATION_IPC_CHANNELS.retry,
        request,
      ),
    deleteVideoExplanation: (request) =>
      invoke<void>(VIDEO_EXPLANATION_IPC_CHANNELS.delete, request),
    onVideoExplanationChanged: (listener) => {
      const handler = (_event: IpcRendererEvent, value: unknown) => {
        if (isVideoExplanationEvent(value)) listener(value);
      };
      ipcRenderer.on(VIDEO_EXPLANATION_IPC_CHANNELS.changed, handler);
      return () =>
        ipcRenderer.removeListener(
          VIDEO_EXPLANATION_IPC_CHANNELS.changed,
          handler,
        );
    },
  } satisfies VideoExplanationPreloadApi);
}
