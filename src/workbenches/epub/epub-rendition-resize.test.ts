import { describe, expect, it, vi } from 'vitest';

import {
  observeEpubRenditionSize,
  type EpubRenditionResizeEnvironment,
} from './epub-rendition-resize';

function resizeEntry(
  target: Element,
  width: number,
  height: number,
): ResizeObserverEntry {
  return {
    target,
    contentRect: { width, height } as DOMRectReadOnly,
  } as ResizeObserverEntry;
}

describe('EPUB rendition resize observer', () => {
  it('resizes immediately and coalesces rapid sidebar layout changes into the latest frame', () => {
    const host = {
      clientWidth: 900,
      clientHeight: 600,
    } as HTMLElement;
    const resize = vi.fn();
    const observe = vi.fn();
    const disconnect = vi.fn();
    const cancelFrame = vi.fn();
    let observerCallback: ResizeObserverCallback | undefined;
    let nextFrame: FrameRequestCallback | undefined;
    const environment: EpubRenditionResizeEnvironment = {
      createObserver(callback) {
        observerCallback = callback;
        return { observe, disconnect };
      },
      requestFrame(callback) {
        nextFrame = callback;
        return 7;
      },
      cancelFrame,
    };

    const dispose = observeEpubRenditionSize(
      host,
      { resize },
      environment,
    );

    expect(observe).toHaveBeenCalledWith(host);
    nextFrame?.(0);
    expect(resize).toHaveBeenLastCalledWith(900, 600);

    observerCallback?.(
      [resizeEntry(host, 720, 600)],
      {} as ResizeObserver,
    );
    observerCallback?.(
      [resizeEntry(host, 640, 600)],
      {} as ResizeObserver,
    );
    expect(resize).toHaveBeenCalledTimes(1);
    nextFrame?.(1);
    expect(resize).toHaveBeenLastCalledWith(640, 600);
    expect(resize).toHaveBeenCalledTimes(2);

    observerCallback?.(
      [resizeEntry(host, 0, 600)],
      {} as ResizeObserver,
    );
    expect(resize).toHaveBeenCalledTimes(2);

    dispose();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('cancels a pending resize when the reader is disposed', () => {
    const cancelFrame = vi.fn();
    const environment: EpubRenditionResizeEnvironment = {
      createObserver: () => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
      }),
      requestFrame: () => 11,
      cancelFrame,
    };

    const dispose = observeEpubRenditionSize(
      { clientWidth: 800, clientHeight: 500 } as HTMLElement,
      { resize: vi.fn() },
      environment,
    );
    dispose();

    expect(cancelFrame).toHaveBeenCalledWith(11);
  });
});
