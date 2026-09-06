import { useEffect, useRef, useState } from 'react';

import {
  MarkdownEditorAdapter,
  type MarkdownEditorAdapterOptions,
} from './markdown-editor-adapter';

export type MarkdownVisualEditorState = 'loading' | 'ready' | 'failed';

export interface UseMarkdownVisualEditorOptions
  extends Omit<MarkdownEditorAdapterOptions, 'host' | 'signal'> {
  readonly enabled: boolean;
  readonly resetKey: string | number;
  readonly onAdapterChange?: (
    adapter: MarkdownEditorAdapter | undefined,
  ) => void;
}

export function useMarkdownVisualEditor(
  options: UseMarkdownVisualEditorOptions,
): {
  readonly hostRef: React.RefObject<HTMLDivElement | null>;
  readonly state: MarkdownVisualEditorState;
} {
  const hostRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(options);
  const initializationRef = useRef(0);
  const [state, setState] = useState<MarkdownVisualEditorState>('loading');
  optionsRef.current = options;

  useEffect(() => {
    const currentOptions = optionsRef.current;
    const host = hostRef.current;
    if (!currentOptions.enabled || !host) {
      return;
    }

    let active = true;
    const initialization = ++initializationRef.current;
    const abortController = new AbortController();
    setState('loading');
    const editorHost = document.createElement('div');
    editorHost.style.height = '100%';
    editorHost.style.minHeight = '0';
    host.replaceChildren(editorHost);
    let ownedAdapter: MarkdownEditorAdapter | undefined;

    void MarkdownEditorAdapter.create({
      host: editorHost,
      initialValue: currentOptions.initialValue,
      initialScrollTop: currentOptions.initialScrollTop,
      outlineVisible: currentOptions.outlineVisible,
      onInput: (value) => optionsRef.current.onInput(value),
      onScroll: (scrollTop) => optionsRef.current.onScroll(scrollTop),
      onOpenExternal: (url) => optionsRef.current.onOpenExternal(url),
      onError: (error) => optionsRef.current.onError(error),
      ...(currentOptions.resourceBaseUrl
        ? { resourceBaseUrl: currentOptions.resourceBaseUrl }
        : {}),
      ...(currentOptions.readyTimeoutMs !== undefined
        ? { readyTimeoutMs: currentOptions.readyTimeoutMs }
        : {}),
      ...(currentOptions.isInternalLinkAllowed
        ? {
            isInternalLinkAllowed: (url: string) =>
              optionsRef.current.isInternalLinkAllowed?.(url) ?? false,
          }
        : {}),
      ...(currentOptions.onOpenInternalLink
        ? {
            onOpenInternalLink: (url: string) =>
              optionsRef.current.onOpenInternalLink?.(url),
          }
        : {}),
      ...(currentOptions.readLocalImageSource
        ? {
            readLocalImageSource: (relativePath: string) =>
              optionsRef.current.readLocalImageSource?.(relativePath) ??
              Promise.resolve(undefined),
          }
        : {}),
      signal: abortController.signal,
    })
      .then((adapter) => {
        ownedAdapter = adapter;
        if (
          !active ||
          initializationRef.current !== initialization
        ) {
          adapter.destroy();
          return;
        }

        optionsRef.current.onAdapterChange?.(adapter);
        setState('ready');
      })
      .catch((error) => {
        if (
          !active ||
          initializationRef.current !== initialization ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }

        editorHost.replaceChildren();
        setState('failed');
        optionsRef.current.onError(error);
      });

    return () => {
      active = false;
      abortController.abort();
      if (ownedAdapter) {
        optionsRef.current.onAdapterChange?.(undefined);
      }
      ownedAdapter?.destroy();
      editorHost.remove();
    };
  }, [options.enabled, options.resetKey]);

  return { hostRef, state };
}
