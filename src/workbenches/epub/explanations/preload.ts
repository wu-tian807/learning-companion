import type { IpcRenderer, IpcRendererEvent } from 'electron';

import type { WorkbenchFeatureIpcInvoke } from '../../../preload/workbench-preload-contribution';

import {
  EPUB_EXPLANATION_IPC_CHANNELS,
  isEpubExplanationEvent,
  type EpubExplanationEvent,
  type EpubExplanationPreloadApi,
  type EpubExplanationView,
} from './shared';

function subscribeEpubExplanationEvents(
  ipcRenderer: IpcRenderer,
  listener: (event: EpubExplanationEvent) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, value: unknown) => {
    if (isEpubExplanationEvent(value)) {
      listener(value);
    }
  };

  ipcRenderer.on(EPUB_EXPLANATION_IPC_CHANNELS.changed, handler);
  return () =>
    ipcRenderer.removeListener(EPUB_EXPLANATION_IPC_CHANNELS.changed, handler);
}

export function createEpubExplanationPreloadApi(
  ipcRenderer: IpcRenderer,
  invoke: WorkbenchFeatureIpcInvoke,
): EpubExplanationPreloadApi {
  return Object.freeze({
    listEpubExplanations: (request) =>
      invoke<EpubExplanationView[]>(
        EPUB_EXPLANATION_IPC_CHANNELS.list,
        request,
      ),
    createEpubExplanation: (request) =>
      invoke<EpubExplanationView>(
        EPUB_EXPLANATION_IPC_CHANNELS.create,
        request,
      ),
    retryEpubExplanation: (request) =>
      invoke<EpubExplanationView>(EPUB_EXPLANATION_IPC_CHANNELS.retry, request),
    deleteEpubExplanation: (request) =>
      invoke<void>(EPUB_EXPLANATION_IPC_CHANNELS.delete, request),
    onEpubExplanationChanged: (listener) =>
      subscribeEpubExplanationEvents(ipcRenderer, listener),
  } satisfies EpubExplanationPreloadApi);
}
