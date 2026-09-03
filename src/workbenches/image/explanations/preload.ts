import type { IpcRenderer, IpcRendererEvent } from 'electron';

import type { WorkbenchFeatureIpcInvoke } from '../../../preload/workbench-preload-contribution';
import {
  IMAGE_EXPLANATION_IPC_CHANNELS,
  isImageExplanationEvent,
  type ImageExplanationAttachmentView,
  type ImageExplanationPreloadApi,
  type ImageExplanationView,
} from './shared';

export function createImageExplanationPreloadApi(
  ipcRenderer: IpcRenderer,
  invoke: WorkbenchFeatureIpcInvoke,
): ImageExplanationPreloadApi {
  return Object.freeze({
    listImageExplanations: (request) =>
      invoke<ImageExplanationView[]>(IMAGE_EXPLANATION_IPC_CHANNELS.list, request),
    createImageExplanation: (request) =>
      invoke<ImageExplanationView>(IMAGE_EXPLANATION_IPC_CHANNELS.create, request),
    retryImageExplanation: (request) =>
      invoke<ImageExplanationView>(IMAGE_EXPLANATION_IPC_CHANNELS.retry, request),
    deleteImageExplanation: (request) =>
      invoke<void>(IMAGE_EXPLANATION_IPC_CHANNELS.delete, request),
    updateImageExplanationMarkerColor: (request) =>
      invoke<ImageExplanationAttachmentView>(
        IMAGE_EXPLANATION_IPC_CHANNELS.updateMarkerColor,
        request,
      ),
    onImageExplanationChanged: (listener) => {
      const handler = (_event: IpcRendererEvent, value: unknown) => {
        if (isImageExplanationEvent(value)) listener(value);
      };
      ipcRenderer.on(IMAGE_EXPLANATION_IPC_CHANNELS.changed, handler);
      return () =>
        ipcRenderer.removeListener(IMAGE_EXPLANATION_IPC_CHANNELS.changed, handler);
    },
  } satisfies ImageExplanationPreloadApi);
}
