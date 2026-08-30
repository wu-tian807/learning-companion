import type { Rendition } from 'epubjs';

export interface EpubRenditionResizeEnvironment {
  readonly createObserver: (
    callback: ResizeObserverCallback,
  ) => Pick<ResizeObserver, 'observe' | 'disconnect'>;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
}

export function observeEpubRenditionSize(
  host: HTMLElement,
  rendition: Pick<Rendition, 'resize'>,
  environment?: EpubRenditionResizeEnvironment,
): () => void {
  const resolvedEnvironment = environment ?? {
    createObserver: (callback: ResizeObserverCallback) =>
      new ResizeObserver(callback),
    requestFrame: (callback: FrameRequestCallback) =>
      window.requestAnimationFrame(callback),
    cancelFrame: (handle: number) =>
      window.cancelAnimationFrame(handle),
  };
  let disposed = false;
  let frame: number | undefined;
  let pendingSize:
    | { readonly width: number; readonly height: number }
    | undefined;
  let appliedSize:
    | { readonly width: number; readonly height: number }
    | undefined;

  const schedule = (width: number, height: number) => {
    const next = {
      width: Math.round(width),
      height: Math.round(height),
    };
    if (
      disposed ||
      next.width <= 0 ||
      next.height <= 0 ||
      (pendingSize?.width === next.width &&
        pendingSize.height === next.height) ||
      (frame === undefined &&
        appliedSize?.width === next.width &&
        appliedSize.height === next.height)
    ) {
      return;
    }

    pendingSize = next;
    if (frame !== undefined) return;
    frame = resolvedEnvironment.requestFrame(() => {
      frame = undefined;
      const size = pendingSize;
      pendingSize = undefined;
      if (
        disposed ||
        !size ||
        (appliedSize?.width === size.width &&
          appliedSize.height === size.height)
      ) {
        return;
      }
      rendition.resize(size.width, size.height);
      appliedSize = size;
    });
  };

  const observer = resolvedEnvironment.createObserver((entries) => {
    const entry = entries.find((candidate) => candidate.target === host);
    if (entry) {
      schedule(entry.contentRect.width, entry.contentRect.height);
    }
  });
  observer.observe(host);
  schedule(host.clientWidth, host.clientHeight);

  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    if (frame !== undefined) {
      resolvedEnvironment.cancelFrame(frame);
      frame = undefined;
    }
    pendingSize = undefined;
  };
}
